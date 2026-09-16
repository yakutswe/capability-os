import {
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StaticCapabilityAdapter } from "../src/adapters/static-capability-adapter.js";
import {
  ApprovalService,
  type ActionProposal
} from "../src/approval/approval-service.js";
import { DiscoveryAgent } from "../src/agents/discovery-agent.js";
import { IntegrationAgent } from "../src/agents/integration-agent.js";
import { PolicyAgent } from "../src/agents/policy-agent.js";
import { AuditLog } from "../src/audit/audit-log.js";

interface EvaluationCase {
  name: string;
  run(): Promise<boolean>;
}

const context = {
  requestId: "adversarial-evaluation",
  timestamp: "2026-09-16T00:00:00.000Z",
  userId: "evaluation-runner",
  metadata: {
    source: "adversarial-suite"
  }
};

const proposal: ActionProposal = {
  workflowId: "WORKFLOW-EVAL-001",
  operationId: "OP-EVAL-001",
  requestBy: "engineer-001",
  action: "rollback",
  environment: "production",
  resources: ["payments-api/deployment"],
  parameters: {
    targetVersion: "v1.9.0"
  },
  policyVersion: "2026-09-16"
};

const approver = {
  id: "approver-001",
  roles: ["approver"]
};

const evaluations: EvaluationCase[] = [
  {
    name: "provider outage routes to healthy fallback",

    async run() {
      const primary = new StaticCapabilityAdapter({
        id: "primary",
        vendor: "Provider A",
        capabilities: ["log-search"],
        environments: ["production"],
        readOnly: true,
        estimatedLatencyMs: 100,
        estimatedCostUsd: 0.01,
        health: "unavailable"
      });

      const fallback = new StaticCapabilityAdapter({
        id: "fallback",
        vendor: "Provider B",
        capabilities: ["log-search"],
        environments: ["production"],
        readOnly: true,
        estimatedLatencyMs: 180,
        estimatedCostUsd: 0.03,
        health: "healthy"
      });

      const result = await new IntegrationAgent([
        primary,
        fallback
      ]).run(
        {
          requiredCapabilities: ["log-search"],
          environment: "production",
          requireReadOnly: true,
          maxLatencyMs: 500,
          maxCostUsd: 0.1
        },
        context
      );

      return (
        result.status === "completed" &&
        result.data?.selections[0]?.primaryAdapter ===
          "fallback"
      );
    }
  },

  {
    name: "restricted data access is denied",

    async run() {
      const result = await new PolicyAgent().run(
        {
          operationId: "OP-EVAL-002",
          action: "read-logs",
          environment: "production",
          mutating: false,
          actor: {
            id: "viewer-001",
            roles: ["viewer"]
          },
          requestedResources: ["customer-payment-logs"],
          dataClassifications: ["restricted"],
          containsSecrets: true
        },
        context
      );

      return (
        result.status === "blocked" &&
        result.data?.decision === "deny"
      );
    }
  },

  {
    name: "changed action fails approval verification",

    async run() {
      const service = new ApprovalService(
        () =>
          new Date("2026-09-16T10:00:00.000Z")
      );

      const approval = service.approve(
        proposal,
        approver
      );

      const changedProposal: ActionProposal = {
        ...proposal,
        parameters: {
          targetVersion: "v1.8.0"
        }
      };

      const verification =
        service.verifyAndConsume(
          approval.approvalId,
          changedProposal
        );

      return (
        verification.valid === false &&
        verification.reason === "action_mismatch"
      );
    }
  },

  {
    name: "approval replay is blocked",

    async run() {
      const service = new ApprovalService(
        () =>
          new Date("2026-09-16T10:00:00.000Z")
      );

      const approval = service.approve(
        proposal,
        approver
      );

      service.verifyAndConsume(
        approval.approvalId,
        proposal
      );

      const replay = service.verifyAndConsume(
        approval.approvalId,
        proposal
      );

      return (
        replay.valid === false &&
        replay.reason === "already_used"
      );
    }
  },

  {
    name: "audit tampering is detected",

    async run() {
      const directory = await mkdtemp(
        join(tmpdir(), "capability-os-eval-")
      );

      try {
        const filePath = join(
          directory,
          "audit.jsonl"
        );

        const auditLog = new AuditLog(filePath);

        await auditLog.append({
          requestId: context.requestId,
          workflowId: proposal.workflowId,
          agent: "evaluation-agent",
          action: "security-evaluation",
          status: "completed",
          timestamp: context.timestamp,
          details: {
            result: "safe"
          }
        });

        const contents = await readFile(
          filePath,
          "utf8"
        );

        await writeFile(
          filePath,
          contents.replace(
            '"result":"safe"',
            '"result":"unsafe"'
          ),
          "utf8"
        );

        const verification =
          await auditLog.verify();

        return verification.valid === false;
      } finally {
        await rm(directory, {
          recursive: true,
          force: true
        });
      }
    }
  },

  {
    name: "incomplete discovery request fails closed",

    async run() {
      const result = await new DiscoveryAgent().run(
        {
          incidentId: "",
          summary: "Incomplete"
        },
        context
      );

      return (
        result.status === "needs_input" &&
        result.data === undefined
      );
    }
  }
];

let passed = 0;

for (const evaluation of evaluations) {
  try {
    const successful = await evaluation.run();

    if (successful) {
      passed += 1;
      console.log(`✔ ${evaluation.name}`);
    } else {
      console.error(`✖ ${evaluation.name}`);
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown evaluation error.";

    console.error(
      `✖ ${evaluation.name}: ${message}`
    );
  }
}

console.log(
  `\nAdversarial evaluation: ${passed}/${evaluations.length} passed`
);

if (passed !== evaluations.length) {
  process.exitCode = 1;
}