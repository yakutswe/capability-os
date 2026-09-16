import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ApprovalService,
  type ActionProposal
} from "../../../approval/approval-service.js";

import { AuditLog } from "../../../audit/audit-log.js";

import {
  SafeExecutor,
  type ExecutionAdapter
} from "../../../execution/safe-executor.js";

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) {
      throw new Error(
        `Expected ${String(expected)}, received ${String(actual)}`
      );
    }
  }
};

const proposal: ActionProposal = {
  workflowId: "WORKFLOW-EXEC-001",
  operationId: "OP-EXEC-001",
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

const context = {
  requestId: "execution-test-001",
  timestamp: "2026-09-16T00:00:00.000Z",
  userId: "engineer-001",
  metadata: {
    source: "automated-test"
  }
};

function createApprovalService() {
  return new ApprovalService(
    () => new Date("2026-09-16T10:00:00.000Z")
  );
}

test("executes an exactly approved action", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-execution-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const approvalService = createApprovalService();
  const auditLog = new AuditLog(
    join(directory, "audit.jsonl")
  );

  const executor = new SafeExecutor(
    approvalService,
    auditLog
  );

  const adapter: ExecutionAdapter = {
    id: "deployment-adapter",

    async execute() {
      return {
        success: true,
        message: "Rollback completed successfully.",
        partialChange: false,
        details: {
          version: "v1.9.0"
        }
      };
    }
  };

  const approval = approvalService.approve(
    proposal,
    approver
  );

  const result = await executor.executeApprovedAction(
    approval.approvalId,
    proposal,
    adapter,
    context
  );

  assert.equal(result.status, "executed");
  assert.equal(result.approval.valid, true);

  const verification = await auditLog.verify();

  assert.equal(verification.valid, true);
  assert.equal(verification.recordCount, 2);
});

test("blocks execution when the action changes", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-execution-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const approvalService = createApprovalService();
  const auditLog = new AuditLog(
    join(directory, "audit.jsonl")
  );

  const executor = new SafeExecutor(
    approvalService,
    auditLog
  );

  let executionCount = 0;

  const adapter: ExecutionAdapter = {
    id: "deployment-adapter",

    async execute() {
      executionCount += 1;

      return {
        success: true,
        message: "Executed.",
        partialChange: false,
        details: {}
      };
    }
  };

  const approval = approvalService.approve(
    proposal,
    approver
  );

  const changedProposal: ActionProposal = {
    ...proposal,
    parameters: {
      targetVersion: "v1.8.0"
    }
  };

  const result = await executor.executeApprovedAction(
    approval.approvalId,
    changedProposal,
    adapter,
    context
  );

  assert.equal(result.status, "blocked");
  assert.equal(
    result.approval.reason,
    "action_mismatch"
  );
  assert.equal(executionCount, 0);
});

test("rolls back a sealed partial failure", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-execution-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const approvalService = createApprovalService();
  const auditLog = new AuditLog(
    join(directory, "audit.jsonl")
  );

  const executor = new SafeExecutor(
    approvalService,
    auditLog
  );

  const adapter: ExecutionAdapter = {
    id: "deployment-adapter",

    async execute() {
      return {
        success: false,
        message: "Deployment changed partially.",
        partialChange: true,
        details: {
          changedInstances: 2
        }
      };
    },

    async rollback() {
      return {
        success: true,
        message: "Previous state restored."
      };
    }
  };

  const approval = approvalService.approve(
    proposal,
    approver
  );

  const result = await executor.executeApprovedAction(
    approval.approvalId,
    proposal,
    adapter,
    context
  );

  assert.equal(result.status, "rolled_back");
  assert.equal(result.rollback?.success, true);

  const verification = await auditLog.verify();

  assert.equal(verification.valid, true);
});

test("blocks replay after successful execution", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-execution-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const approvalService = createApprovalService();
  const auditLog = new AuditLog(
    join(directory, "audit.jsonl")
  );

  const executor = new SafeExecutor(
    approvalService,
    auditLog
  );

  let executionCount = 0;

  const adapter: ExecutionAdapter = {
    id: "deployment-adapter",

    async execute() {
      executionCount += 1;

      return {
        success: true,
        message: "Executed.",
        partialChange: false,
        details: {}
      };
    }
  };

  const approval = approvalService.approve(
    proposal,
    approver
  );

  await executor.executeApprovedAction(
    approval.approvalId,
    proposal,
    adapter,
    context
  );

  const replay = await executor.executeApprovedAction(
    approval.approvalId,
    proposal,
    adapter,
    context
  );

  assert.equal(replay.status, "blocked");
  assert.equal(
    replay.approval.reason,
    "already_used"
  );
  assert.equal(executionCount, 1);
});