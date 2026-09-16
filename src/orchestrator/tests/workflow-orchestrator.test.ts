import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StaticCapabilityAdapter } from "../../adapters/static-capability-adapter.js";
import { DiscoveryAgent } from "../../agents/discovery-agent.js";
import { EvaluationAgent } from "../../agents/evaluation-agent.js";
import { IntegrationAgent } from "../../agents/integration-agent.js";
import { PolicyAgent } from "../../agents/policy-agent.js";
import { AuditLog } from "../../audit/audit-log.js";
import { WorkflowOrchestrator } from "../workflow-orchestrator.js";

const context = {
  requestId: "orchestrator-test-001",
  timestamp: "2026-09-16T00:00:00.000Z",
  userId: "incident-commander",
  metadata: {
    source: "end-to-end-test"
  }
};

function createOrchestrator(auditPath: string) {
  const primary = new StaticCapabilityAdapter({
    id: "primary-observability",
    vendor: "Provider A",
    capabilities: ["log-search", "metrics-read"],
    environments: ["production"],
    readOnly: true,
    estimatedLatencyMs: 100,
    estimatedCostUsd: 0.01,
    health: "healthy"
  });

  const fallback = new StaticCapabilityAdapter({
    id: "fallback-observability",
    vendor: "Provider B",
    capabilities: ["log-search", "metrics-read"],
    environments: ["production"],
    readOnly: true,
    estimatedLatencyMs: 180,
    estimatedCostUsd: 0.03,
    health: "healthy"
  });

  const knowledge = new StaticCapabilityAdapter({
    id: "internal-knowledge-mcp",
    vendor: "Internal MCP",
    capabilities: ["runbook-search"],
    environments: ["production"],
    readOnly: true,
    estimatedLatencyMs: 40,
    estimatedCostUsd: 0,
    health: "healthy"
  });

  return new WorkflowOrchestrator(
    new DiscoveryAgent(),
    new IntegrationAgent([
      primary,
      fallback,
      knowledge
    ]),
    new PolicyAgent(),
    new EvaluationAgent(),
    new AuditLog(auditPath)
  );
}

const validWorkflowRequest = {
  workflowId: "WORKFLOW-E2E-001",

  discoveryInput: {
    incidentId: "INC-E2E-001",
    summary:
      "Payment failures increased after the latest deployment.",
    affectedService: "payments-api",
    environment: "production",
    urgency: "critical",
    observedSymptoms: [
      "Checkout requests return HTTP 500"
    ],
    requestedOutcome:
      "Identify the cause and prepare a safe rollback.",
    knownConstraints: [
      "Preserve all existing payment records."
    ]
  },

  integrationInput: {
    requiredCapabilities: [
      "log-search",
      "runbook-search"
    ],
    environment: "production",
    requireReadOnly: true,
    maxLatencyMs: 500,
    maxCostUsd: 0.1
  },

  policyInput: {
    operationId: "OP-E2E-001",
    action: "rollback",
    environment: "production",
    mutating: true,
    actor: {
      id: "engineer-001",
      roles: [
        "incident-responder",
        "operator"
      ]
    },
    requestedResources: [
      "payments-api/deployment"
    ],
    dataClassifications: ["internal"],
    containsSecrets: false
  },

  thresholds: {
    minimumOverallScore: 80,
    maximumCostUsd: 0.5,
    maximumLatencyMs: 500,
    minimumFallbackCoverage: 0.5
  }
};

test("runs the complete workflow and waits for approval", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-workflow-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const orchestrator = createOrchestrator(
    join(directory, "audit.jsonl")
  );

  const result = await orchestrator.run(
    validWorkflowRequest,
    context
  );

  assert.equal(result.status, "awaiting_approval");
  assert.equal(
    result.discovery.data?.riskLevel,
    "critical"
  );
  assert.equal(
    result.policy?.data?.decision,
    "approval_required"
  );
  assert.equal(
    result.evaluation?.data?.passed,
    true
  );
  assert.equal(result.audit.valid, true);
  assert.equal(result.audit.recordCount, 6);
});

test("fails closed when discovery input is invalid", async (t) => {
  const directory = await mkdtemp(
    join(tmpdir(), "capability-os-workflow-")
  );

  t.after(async () => {
    await rm(directory, {
      recursive: true,
      force: true
    });
  });

  const orchestrator = createOrchestrator(
    join(directory, "audit.jsonl")
  );

  const result = await orchestrator.run(
    {
      ...validWorkflowRequest,
      workflowId: "WORKFLOW-E2E-002",
      discoveryInput: {
        incidentId: "",
        summary: "Too short"
      }
    },
    context
  );

  assert.equal(result.status, "blocked");
  assert.equal(
    result.discovery.status,
    "needs_input"
  );
  assert.equal(result.integration, undefined);
  assert.equal(result.policy, undefined);
  assert.equal(result.audit.valid, true);
  assert.equal(result.audit.recordCount, 3);
});