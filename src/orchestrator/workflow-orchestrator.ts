import type { AuditVerification } from "../audit/audit-log.js";
import { AuditLog } from "../audit/audit-log.js";

import {
  DiscoveryAgent,
  type DiscoveryOutput
} from "../agents/discovery-agent.js";

import {
  EvaluationAgent,
  type EvaluationOutput
} from "../agents/evaluation-agent.js";

import {
  IntegrationAgent,
  type IntegrationPlan
} from "../agents/integration-agent.js";

import {
  PolicyAgent,
  type PolicyDecision
} from "../agents/policy-agent.js";

import type {
  AgentContext,
  AgentResult
} from "../types/agent.js";

export interface WorkflowRequest {
  workflowId: string;
  discoveryInput: unknown;
  integrationInput: unknown;
  policyInput: unknown;

  thresholds?: {
    minimumOverallScore?: number;
    maximumCostUsd?: number;
    maximumLatencyMs?: number;
    minimumFallbackCoverage?: number;
  };
}

export type WorkflowStatus =
  | "completed"
  | "awaiting_approval"
  | "blocked";

export interface WorkflowOutcome {
  workflowId: string;
  status: WorkflowStatus;
  discovery: AgentResult<DiscoveryOutput>;
  integration?: AgentResult<IntegrationPlan>;
  policy?: AgentResult<PolicyDecision>;
  evaluation?: AgentResult<EvaluationOutput>;
  audit: AuditVerification;
}

export class WorkflowOrchestrator {
  constructor(
    private readonly discoveryAgent: DiscoveryAgent,
    private readonly integrationAgent: IntegrationAgent,
    private readonly policyAgent: PolicyAgent,
    private readonly evaluationAgent: EvaluationAgent,
    private readonly auditLog: AuditLog
  ) {}

  async run(
    request: WorkflowRequest,
    context: AgentContext
  ): Promise<WorkflowOutcome> {
    await this.auditLog.append({
      requestId: context.requestId,
      workflowId: request.workflowId,
      agent: "orchestrator",
      action: "workflow-started",
      status: "started",
      timestamp: new Date().toISOString(),
      details: {
        userId: context.userId ?? "unknown"
      }
    });

    const discovery = await this.discoveryAgent.run(
      request.discoveryInput,
      context
    );

    await this.recordAgentResult(
      request.workflowId,
      context,
      discovery
    );

    if (
      discovery.status !== "completed" ||
      !discovery.data
    ) {
      return this.finishBlockedWorkflow(
        request.workflowId,
        context,
        discovery
      );
    }

    const integration = await this.integrationAgent.run(
      request.integrationInput,
      context
    );

    await this.recordAgentResult(
      request.workflowId,
      context,
      integration
    );

    if (
      integration.status !== "completed" ||
      !integration.data
    ) {
      await this.recordFinalStatus(
        request.workflowId,
        context,
        "blocked"
      );

      return {
        workflowId: request.workflowId,
        status: "blocked",
        discovery,
        integration,
        audit: await this.auditLog.verify()
      };
    }

    const policy = await this.policyAgent.run(
      request.policyInput,
      context
    );

    await this.recordAgentResult(
      request.workflowId,
      context,
      policy
    );

    if (!policy.data) {
      await this.recordFinalStatus(
        request.workflowId,
        context,
        "blocked"
      );

      return {
        workflowId: request.workflowId,
        status: "blocked",
        discovery,
        integration,
        policy,
        audit: await this.auditLog.verify()
      };
    }

    const requiredCapabilities =
      integration.data.selections.length +
      integration.data.unresolvedCapabilities.length;

    const fallbackProtectedCapabilities =
      integration.data.selections.filter(
        (selection) =>
          selection.fallbackAdapter !== undefined
      ).length;

    const evaluation = await this.evaluationAgent.run(
      {
        workflowId: request.workflowId,

        discovery: {
          status: discovery.status,
          successCriteriaCount:
            discovery.data.successCriteria.length,
          constraintCount:
            discovery.data.constraints.length,
          riskLevel: discovery.data.riskLevel,
          requiresHumanApproval:
            discovery.data.requiresHumanApproval
        },

        integration: {
          status: integration.status,
          requiredCapabilities,
          resolvedCapabilities:
            integration.data.selections.length,
          fallbackProtectedCapabilities,
          estimatedCostUsd:
            integration.data.estimatedTotalCostUsd,
          maximumLatencyMs:
            integration.data.maximumEstimatedLatencyMs
        },

        policy: {
          decision: policy.data.decision,
          violationsCount:
            policy.data.violations.length,
          auditRequired:
            policy.data.auditRequired
        },

        thresholds: {
          minimumOverallScore:
            request.thresholds?.minimumOverallScore ?? 80,
          maximumCostUsd:
            request.thresholds?.maximumCostUsd ?? 0.5,
          maximumLatencyMs:
            request.thresholds?.maximumLatencyMs ?? 500,
          minimumFallbackCoverage:
            request.thresholds?.minimumFallbackCoverage ?? 0.5
        }
      },
      context
    );

    await this.recordAgentResult(
      request.workflowId,
      context,
      evaluation
    );

    const status = this.determineWorkflowStatus(
      policy,
      evaluation
    );

    await this.recordFinalStatus(
      request.workflowId,
      context,
      status
    );

    return {
      workflowId: request.workflowId,
      status,
      discovery,
      integration,
      policy,
      evaluation,
      audit: await this.auditLog.verify()
    };
  }

  private determineWorkflowStatus(
    policy: AgentResult<PolicyDecision>,
    evaluation: AgentResult<EvaluationOutput>
  ): WorkflowStatus {
    if (
      policy.data?.decision === "deny" ||
      evaluation.data?.passed !== true
    ) {
      return "blocked";
    }

    if (
      policy.data?.decision === "approval_required"
    ) {
      return "awaiting_approval";
    }

    return "completed";
  }

  private async finishBlockedWorkflow(
    workflowId: string,
    context: AgentContext,
    discovery: AgentResult<DiscoveryOutput>
  ): Promise<WorkflowOutcome> {
    await this.recordFinalStatus(
      workflowId,
      context,
      "blocked"
    );

    return {
      workflowId,
      status: "blocked",
      discovery,
      audit: await this.auditLog.verify()
    };
  }

  private async recordAgentResult(
    workflowId: string,
    context: AgentContext,
    result: {
      agent: string;
      status: string;
      warnings: string[];
    }
  ): Promise<void> {
    await this.auditLog.append({
      requestId: context.requestId,
      workflowId,
      agent: result.agent,
      action: "agent-completed",
      status: result.status,
      timestamp: new Date().toISOString(),
      details: {
        warningCount: result.warnings.length
      }
    });
  }

  private async recordFinalStatus(
    workflowId: string,
    context: AgentContext,
    status: WorkflowStatus
  ): Promise<void> {
    await this.auditLog.append({
      requestId: context.requestId,
      workflowId,
      agent: "orchestrator",
      action: "workflow-finished",
      status,
      timestamp: new Date().toISOString(),
      details: {
        finalStatus: status
      }
    });
  }
}