import { randomUUID } from "node:crypto";

import { StaticCapabilityAdapter } from "./adapters/static-capability-adapter.js";
import { DiscoveryAgent } from "./agents/discovery-agent.js";
import { IntegrationAgent } from "./agents/integration-agent.js";

const context = {
  requestId: randomUUID(),
  timestamp: new Date().toISOString(),
  userId: "incident-commander",
  metadata: {
    source: "command-line-demo"
  }
};

const discoveryAgent = new DiscoveryAgent();

const discoveryResult = await discoveryAgent.run(
  {
    incidentId: "INC-2026-001",
    summary: "Payment failures increased after the latest deployment.",
    affectedService: "payments-api",
    environment: "production",
    urgency: "critical",
    observedSymptoms: [
      "Checkout requests return HTTP 500",
      "Payment success rate dropped below 70%"
    ],
    requestedOutcome:
      "Identify the likely cause and prepare a safe recovery plan.",
    knownConstraints: [
      "Preserve existing payment records.",
      "Do not interrupt unaffected customers."
    ]
  },
  context
);

console.log("\n=== DISCOVERY RESULT ===");
console.dir(discoveryResult, { depth: null });

const primaryObservabilityAdapter =
  new StaticCapabilityAdapter({
    id: "observability-primary",
    vendor: "Cloud Provider A",
    capabilities: [
      "log-search",
      "metrics-read",
      "deployment-read"
    ],
    environments: [
      "development",
      "staging",
      "production"
    ],
    readOnly: true,
    estimatedLatencyMs: 100,
    estimatedCostUsd: 0.01,
    health: "healthy"
  });

const fallbackObservabilityAdapter =
  new StaticCapabilityAdapter({
    id: "observability-fallback",
    vendor: "Cloud Provider B",
    capabilities: [
      "log-search",
      "metrics-read",
      "deployment-read"
    ],
    environments: [
      "development",
      "staging",
      "production"
    ],
    readOnly: true,
    estimatedLatencyMs: 180,
    estimatedCostUsd: 0.03,
    health: "healthy"
  });

const knowledgeAdapter = new StaticCapabilityAdapter({
  id: "internal-knowledge-mcp",
  vendor: "Internal MCP",
  capabilities: ["runbook-search"],
  environments: [
    "development",
    "staging",
    "production"
  ],
  readOnly: true,
  estimatedLatencyMs: 40,
  estimatedCostUsd: 0,
  health: "healthy"
});

const integrationAgent = new IntegrationAgent([
  primaryObservabilityAdapter,
  fallbackObservabilityAdapter,
  knowledgeAdapter
]);

const integrationRequest = {
  requiredCapabilities: [
    "log-search",
    "metrics-read",
    "deployment-read",
    "runbook-search"
  ],
  environment: "production",
  requireReadOnly: true,
  maxLatencyMs: 500,
  maxCostUsd: 0.1
};

const normalPlan = await integrationAgent.run(
  integrationRequest,
  context
);

console.log("\n=== NORMAL INTEGRATION PLAN ===");
console.dir(normalPlan, { depth: null });

primaryObservabilityAdapter.setHealth("unavailable");

const failoverPlan = await integrationAgent.run(
  integrationRequest,
  {
    ...context,
    requestId: randomUUID(),
    timestamp: new Date().toISOString()
  }
);

console.log("\n=== FAILOVER INTEGRATION PLAN ===");
console.dir(failoverPlan, { depth: null });