import type {
  ActionProposal,
  ApprovalVerification
} from "../approval/approval-service.js";

import { ApprovalService } from "../approval/approval-service.js";
import { AuditLog } from "../audit/audit-log.js";
import type { AgentContext } from "../types/agent.js";

export interface AdapterExecutionResult {
  success: boolean;
  message: string;
  partialChange: boolean;
  details: Record<string, unknown>;
}

export interface AdapterRollbackResult {
  success: boolean;
  message: string;
}

export interface ExecutionAdapter {
  readonly id: string;

  execute(
    proposal: ActionProposal
  ): Promise<AdapterExecutionResult>;

  rollback?(
    proposal: ActionProposal
  ): Promise<AdapterRollbackResult>;
}

export type ExecutionStatus =
  | "executed"
  | "blocked"
  | "rolled_back"
  | "failed";

export interface SafeExecutionOutcome {
  status: ExecutionStatus;
  reason: string;
  approval: ApprovalVerification;
  execution?: AdapterExecutionResult;
  rollback?: AdapterRollbackResult;
}

export class SafeExecutor {
  constructor(
    private readonly approvalService: ApprovalService,
    private readonly auditLog: AuditLog
  ) {}

  async executeApprovedAction(
    approvalId: string,
    proposal: ActionProposal,
    adapter: ExecutionAdapter,
    context: AgentContext
  ): Promise<SafeExecutionOutcome> {
    const approval =
      this.approvalService.verifyAndConsume(
        approvalId,
        proposal
      );

    if (!approval.valid) {
      await this.record(
        proposal,
        context,
        adapter.id,
        "execution-blocked",
        "blocked",
        {
          approvalReason: approval.reason
        }
      );

      return {
        status: "blocked",
        reason:
          `Execution blocked: ${approval.reason}.`,
        approval
      };
    }

    await this.record(
      proposal,
      context,
      adapter.id,
      "approval-consumed",
      "approved",
      {
        approvalId
      }
    );

    try {
      const execution =
        await adapter.execute(proposal);

      if (execution.success) {
        await this.record(
          proposal,
          context,
          adapter.id,
          "action-executed",
          "completed",
          {
            partialChange: false
          }
        );

        return {
          status: "executed",
          reason: execution.message,
          approval,
          execution
        };
      }

      if (
        execution.partialChange &&
        adapter.rollback
      ) {
        const rollback =
          await adapter.rollback(proposal);

        await this.record(
          proposal,
          context,
          adapter.id,
          "rollback-attempted",
          rollback.success
            ? "completed"
            : "failed",
          {
            rollbackSuccessful: rollback.success
          }
        );

        return {
          status: rollback.success
            ? "rolled_back"
            : "failed",
          reason: rollback.success
            ? "The action partially failed and was rolled back."
            : "The action and rollback both failed.",
          approval,
          execution,
          rollback
        };
      }

      await this.record(
        proposal,
        context,
        adapter.id,
        "action-failed",
        "failed",
        {
          partialChange: execution.partialChange,
          rollbackAvailable:
            adapter.rollback !== undefined
        }
      );

      return {
        status: "failed",
        reason: execution.message,
        approval,
        execution
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown execution error.";

      await this.record(
        proposal,
        context,
        adapter.id,
        "execution-error",
        "failed",
        {
          error: message
        }
      );

      return {
        status: "failed",
        reason: message,
        approval
      };
    }
  }

  private async record(
    proposal: ActionProposal,
    context: AgentContext,
    adapterId: string,
    action: string,
    status: string,
    details: Record<string, unknown>
  ): Promise<void> {
    await this.auditLog.append({
      requestId: context.requestId,
      workflowId: proposal.workflowId,
      agent: "safe-executor",
      action,
      status,
      timestamp: new Date().toISOString(),
      details: {
        operationId: proposal.operationId,
        proposedAction: proposal.action,
        adapterId,
        ...details
      }
    });
  }
}