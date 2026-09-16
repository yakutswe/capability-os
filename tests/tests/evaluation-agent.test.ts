import assert from "node:assert/strict";
import test from "node:test";

import { EvaluationAgent } from "../../src/agents/evaluation-agent.js";

const agent = new EvaluationAgent();

const context = {
  requestId: "evaluation-test-001",
  timestamp: "2026-09-16T00:00:00.000Z",
  userId: "test-user",
  metadata: {
    source: "automated-test"
  }
};

const healthyWorkflow = {
  workflowId: "WORKFLOW-001",

  discovery: {
    status: "completed",
    successCriteriaCount: 4,
    constraintCount: 5,
    riskLevel: "critical",
    requiresHumanApproval: true
  },

  integration: {
    status: "completed",
    requiredCapabilities: 4,
    resolvedCapabilities: 4,
    fallbackProtectedCapabilities: 3,
    estimatedCostUsd: 0.03,
    maximumLatencyMs: 100
  },

  policy: {
    decision: "approval_required",
    violationsCount: 0,
    auditRequired: true
  },

  thresholds: {
    minimumOverallScore: 80,
    maximumCostUsd: 0.5,
    maximumLatencyMs: 500,
    minimumFallbackCoverage: 0.5
  }
};

test("passes a safe and resilient workflow", async () => {
  const result = await agent.run(
    healthyWorkflow,
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);
  assert.equal(result.data.passed, true);
  assert.equal(result.data.failures.length, 0);
  assert.equal(
    result.data.metrics.capabilityResolutionRate,
    1
  );
});

test("fails a policy-denied workflow", async () => {
  const result = await agent.run(
    {
      ...healthyWorkflow,
      workflowId: "WORKFLOW-002",
      policy: {
        decision: "deny",
        violationsCount: 1,
        auditRequired: true
      }
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);
  assert.equal(result.data.passed, false);
  assert.ok(
    result.data.failures.some((failure) =>
      failure.includes("Policy Agent denied")
    )
  );
});

test("fails insufficient fallback coverage", async () => {
  const result = await agent.run(
    {
      ...healthyWorkflow,
      workflowId: "WORKFLOW-003",
      integration: {
        ...healthyWorkflow.integration,
        fallbackProtectedCapabilities: 0
      }
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);
  assert.equal(result.data.passed, false);
  assert.equal(result.data.metrics.fallbackCoverage, 0);
  assert.ok(
    result.data.recommendations.some((recommendation) =>
      recommendation.includes("backup adapters")
    )
  );
});