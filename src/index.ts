import { randomUUID } from "node:crypto";

import { DiscoveryAgent } from "./agents/discovery-agent.js";

const discoveryAgent = new DiscoveryAgent();

const result = await discoveryAgent.run(
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
  {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    userId: "incident-commander",
    metadata: {
      source: "command-line-demo"
    }
  }
);

console.dir(result, { depth: null });