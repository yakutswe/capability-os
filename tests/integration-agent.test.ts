import assert from "node:assert/strict";
import test from "node:test";

import { StaticCapabilityAdapter } from "../src/adapters/static-capability-adapter.js";
import { IntegrationAgent } from "../src/agents/integration-agent.js";

const context = {
  requestId: "integration-test-001",
  timestamp: "2026-09-16T00:00:00.000Z",
  userId: "test-user",
  metadata: {
    source: "automated-test"
  }
};

function createObservabilityAdapters() {
  const primary = new StaticCapabilityAdapter({
    id: "primary-provider",
    vendor: "Provider A",
    capabilities: ["log-search", "metrics-read"],
    environments: ["production"],
    readOnly: true,
    estimatedLatencyMs: 100,
    estimatedCostUsd: 0.01,
    health: "healthy"
  });

  const fallback = new StaticCapabilityAdapter({
    id: "fallback-provider",
    vendor: "Provider B",
    capabilities: ["log-search", "metrics-read"],
    environments: ["production"],
    readOnly: true,
    estimatedLatencyMs: 180,
    estimatedCostUsd: 0.03,
    health: "healthy"
  });

  return { primary, fallback };
}

test("selects a primary and fallback adapter", async () => {
  const { primary, fallback } = createObservabilityAdapters();
  const agent = new IntegrationAgent([primary, fallback]);

  const result = await agent.run(
    {
      requiredCapabilities: ["log-search"],
      environment: "production",
      requireReadOnly: true,
      maxLatencyMs: 500,
      maxCostUsd: 0.1
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);

  const selection = result.data.selections[0];

  assert.ok(selection);
  assert.equal(selection.primaryAdapter, "primary-provider");
  assert.equal(selection.fallbackAdapter, "fallback-provider");
});

test("routes to the fallback when the primary is unavailable", async () => {
  const { primary, fallback } = createObservabilityAdapters();
  primary.setHealth("unavailable");

  const agent = new IntegrationAgent([primary, fallback]);

  const result = await agent.run(
    {
      requiredCapabilities: ["log-search"],
      environment: "production",
      requireReadOnly: true,
      maxLatencyMs: 500,
      maxCostUsd: 0.1
    },
    context
  );

  assert.equal(result.status, "completed");
  assert.ok(result.data);

  const selection = result.data.selections[0];

  assert.ok(selection);
  assert.equal(selection.primaryAdapter, "fallback-provider");
});

test("blocks when no adapter satisfies the safety policy", async () => {
  const changeAdapter = new StaticCapabilityAdapter({
    id: "production-change-provider",
    vendor: "Provider C",
    capabilities: ["rollback"],
    environments: ["production"],
    readOnly: false,
    estimatedLatencyMs: 200,
    estimatedCostUsd: 0.05,
    health: "healthy"
  });

  const agent = new IntegrationAgent([changeAdapter]);

  const result = await agent.run(
    {
      requiredCapabilities: ["rollback"],
      environment: "production",
      requireReadOnly: true,
      maxLatencyMs: 500,
      maxCostUsd: 0.1
    },
    context
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.data);
  assert.deepEqual(
    result.data.unresolvedCapabilities,
    ["rollback"]
  );
});