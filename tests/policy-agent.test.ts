import assert from "node:assert/strict";
import test from "node:test";

import { PolicyAgent } from "../src/agents/policy-agent.js";

const agent = new PolicyAgent();

const context = {
  requestId: "policy-test-001",
  timestamp: "2026-09-16T00:00:00.000Z",
  userId: "test-user",
  metadata: {
    source: "automated-test"
  }
};

test("allows authorized read-only production diagnostics", async () => {
  const result = await agent.run(
    {
      operationId: "OP-001",
      action: "read-logs",
      environment: "production",
      mutating: false,
      actor: {
        id: "engineer-001",
        roles: ["incident-responder"]
      },
      requestedResources: ["payments-api/logs"],
      dataClassifications: ["internal"],
      containsSecrets: false
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);
  assert.equal(result.data.decision, "allow");
  assert.equal(result.data.requiresHumanApproval, false);
  assert.equal(result.data.riskLevel, "high");
});

test("requires approval for an authorized production rollback", async () => {
  const result = await agent.run(
    {
      operationId: "OP-002",
      action: "rollback",
      environment: "production",
      mutating: true,
      actor: {
        id: "engineer-002",
        roles: ["incident-responder", "operator"]
      },
      requestedResources: ["payments-api/deployment"],
      dataClassifications: ["internal"],
      containsSecrets: false
    },
    context
  );

  assert.equal(result.status, "needs_input");
  assert.ok(result.data);
  assert.equal(result.data.decision, "approval_required");
  assert.equal(result.data.requiresHumanApproval, true);
  assert.equal(result.data.riskLevel, "critical");
});

test("denies a production change without required roles", async () => {
  const result = await agent.run(
    {
      operationId: "OP-003",
      action: "restart-service",
      environment: "production",
      mutating: true,
      actor: {
        id: "viewer-001",
        roles: ["viewer"]
      },
      requestedResources: ["payments-api"],
      dataClassifications: ["internal"],
      containsSecrets: false
    },
    context
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.data);
  assert.equal(result.data.decision, "deny");
  assert.ok(result.data.violations.length >= 2);
});

test("denies restricted data without security review", async () => {
  const result = await agent.run(
    {
      operationId: "OP-004",
      action: "read-logs",
      environment: "development",
      mutating: false,
      actor: {
        id: "engineer-003",
        roles: ["incident-responder"]
      },
      requestedResources: ["customer-payment-logs"],
      dataClassifications: ["restricted"],
      containsSecrets: true
    },
    context
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.data);
  assert.equal(result.data.decision, "deny");
  assert.ok(
    result.data.violations.some((violation) =>
      violation.includes("security-reviewer")
    )
  );
  assert.ok(result.data.redactions.includes("API keys"));
  assert.ok(
    result.data.redactions.includes("personal information")
  );
});