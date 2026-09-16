/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import { DiscoveryAgent } from "../src/agents/discovery-agent.js";

const agent = new DiscoveryAgent();

const context = {
  requestId: "test-request-001",
  timestamp: "2026-09-15T00:00:00.000Z",
  userId: "test-user",
  metadata: {
    source: "automated-test"
  }
};

test("production-critical incident requires human approval", async () => {
  const result = await agent.run(
    {
      incidentId: "INC-001",
      summary: "Payment failures increased after deployment.",
      affectedService: "payments-api",
      environment: "production",
      urgency: "critical",
      observedSymptoms: ["Checkout requests return HTTP 500"],
      requestedOutcome: "Restore payment processing safely.",
      knownConstraints: ["Preserve all payment records."]
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);
  assert.equal(result.data.riskLevel, "critical");
  assert.equal(result.data.requiresHumanApproval, true);
  assert.ok(
    result.data.constraints.includes(
      "Do not modify production without explicit human approval."
    )
  );
});

test("invalid incident request fails safely", async () => {
  const result = await agent.run(
    {
      incidentId: "",
      summary: "Too short"
    },
    context
  );

  assert.equal(result.status, "needs_input");
  assert.equal(result.data, undefined);
  assert.ok(result.warnings.length > 0);
});

test("low-risk development incident does not require approval", async () => {
  const result = await agent.run(
    {
      incidentId: "INC-002",
      summary: "Development search endpoint is returning empty results.",
      affectedService: "search-api",
      environment: "development",
      urgency: "low",
      observedSymptoms: ["Search results are unexpectedly empty"],
      requestedOutcome: "Identify the development configuration issue."
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);
  assert.equal(result.data.riskLevel, "low");
  assert.equal(result.data.requiresHumanApproval, false);
});