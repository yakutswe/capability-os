import assert from "node:assert/strict";
import test from "node:test";

import {
  ApprovalService,
  type ActionProposal
} from "../src/approval/approval-service.js";

const proposal: ActionProposal = {
  workflowId: "WORKFLOW-001",
  operationId: "OP-001",
  requestBy: "engineer-001",
  action: "rollback",
  environment: "production",
  resources: ["payments-api/deployment"],
  parameters: {
    deploymentId: "deploy-123",
    targetVersion: "v1.9.0"
  },
  policyVersion: "2026-09-16"
};

const approver = {
  id: "approver-001",
  roles: ["approver"]
};

test("approves and consumes the exact action", () => {
  const service = new ApprovalService(
    () => new Date("2026-09-16T10:00:00.000Z")
  );

  const approval = service.approve(
    proposal,
    approver
  );

  const verification = service.verifyAndConsume(
    approval.approvalId,
    proposal
  );

  assert.equal(verification.valid, true);
  assert.equal(verification.reason, "approved");
  assert.ok(
    service.getApproval(approval.approvalId)?.usedAt
  );
});

test("blocks reuse of an approval", () => {
  const service = new ApprovalService(
    () => new Date("2026-09-16T10:00:00.000Z")
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

  assert.equal(replay.valid, false);
  assert.equal(replay.reason, "already_used");
});

test("blocks an action changed after approval", () => {
  const service = new ApprovalService(
    () => new Date("2026-09-16T10:00:00.000Z")
  );

  const approval = service.approve(
    proposal,
    approver
  );

  const changedProposal: ActionProposal = {
    ...proposal,
    parameters: {
      ...proposal.parameters,
      targetVersion: "v1.8.0"
    }
  };

  const verification = service.verifyAndConsume(
    approval.approvalId,
    changedProposal
  );

  assert.equal(verification.valid, false);
  assert.equal(
    verification.reason,
    "action_mismatch"
  );
});

test("blocks an expired approval", () => {
  let currentTime = new Date(
    "2026-09-16T10:00:00.000Z"
  );

  const service = new ApprovalService(
    () => currentTime
  );

  const approval = service.approve(
    proposal,
    approver,
    1_000
  );

  currentTime = new Date(
    "2026-09-16T10:00:02.000Z"
  );

  const verification = service.verifyAndConsume(
    approval.approvalId,
    proposal
  );

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, "expired");
});

test("blocks self-approval", () => {
  const service = new ApprovalService();

  assert.throws(
    () =>
      service.approve(proposal, {
        id: proposal.requestBy,
        roles: ["approver"]
      }),
    /cannot approve their own action/
  );
});

test("blocks users without the approver role", () => {
  const service = new ApprovalService();

  assert.throws(
    () =>
      service.approve(proposal, {
        id: "viewer-001",
        roles: ["viewer"]
      }),
    /approver role/
  );
});