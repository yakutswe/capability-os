import { z } from "zod";

import type {
  Agent,
  AgentContext,
  AgentResult,
  RiskLevel
} from "../types/agent.js";

export const discoveryInputSchema = z.object({
  incidentId: z.string().min(1),
  summary: z.string().min(10),
  affectedService: z.string().min(1),
  environment: z.enum(["development", "staging", "production"]),
  urgency: z.enum(["low", "medium", "high", "critical"]),
  observedSymptoms: z.array(z.string().min(1)).min(1),
  requestedOutcome: z.string().min(1),
  knownConstraints: z.array(z.string()).default([])
});

export const discoveryOutputSchema = z.object({
  problemStatement: z.string(),
  businessObjective: z.string(),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
  requiresHumanApproval: z.boolean(),
  constraints: z.array(z.string()),
  successCriteria: z.array(z.string()),
  assumptions: z.array(z.string())
});

export type DiscoveryOutput = z.infer<typeof discoveryOutputSchema>;

export class DiscoveryAgent implements Agent<unknown, DiscoveryOutput> {
  readonly name = "discovery-agent";

  async run(
    input: unknown,
    context: AgentContext
  ): Promise<AgentResult<DiscoveryOutput>> {
    const parsedInput = discoveryInputSchema.safeParse(input);

    if (!parsedInput.success) {
      return {
        agent: this.name,
        status: "needs_input",
        reasoning: [
          "The incident request failed structured-input validation."
        ],
        warnings: parsedInput.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`
        )
      };
    }

    const incident = parsedInput.data;
    const riskLevel = this.determineRisk(
      incident.environment,
      incident.urgency
    );

    const requiresHumanApproval =
      incident.environment === "production" ||
      riskLevel === "critical";

    const constraints = [
      ...incident.knownConstraints,
      "Do not expose credentials or sensitive customer data.",
      "Record every agent action in the audit trail."
    ];

    if (incident.environment === "production") {
      constraints.push(
        "Do not modify production without explicit human approval."
      );
    }

    const output = discoveryOutputSchema.parse({
      problemStatement:
        `${incident.affectedService} is experiencing ` +
        `${incident.observedSymptoms.join(", ")}. ` +
        `Incident: ${incident.summary}`,

      businessObjective: incident.requestedOutcome,

      riskLevel,

      requiresHumanApproval,

      constraints: [...new Set(constraints)],

      successCriteria: [
        `${incident.affectedService} returns to its expected operating state.`,
        "The root cause is supported by observable evidence.",
        "No unauthorized production changes are performed.",
        `All actions are traceable through request ${context.requestId}.`
      ],

      assumptions: [
        "The supplied incident details are current.",
        "The agent currently has read-only diagnostic access.",
        "Production execution requires a separate approved action."
      ]
    });

    return {
      agent: this.name,
      status: "completed",
      data: output,
      reasoning: [
        `Validated incident ${incident.incidentId}.`,
        `Classified the request as ${riskLevel} risk.`,
        requiresHumanApproval
          ? "Human approval is required before production execution."
          : "Diagnostic work may continue without production execution."
      ],
      warnings: requiresHumanApproval
        ? ["Production-affecting actions are approval-gated."]
        : []
    };
  }

  private determineRisk(
    environment: "development" | "staging" | "production",
    urgency: RiskLevel
  ): RiskLevel {
    if (environment === "production" && urgency === "critical") {
      return "critical";
    }

    if (environment === "production") {
      return "high";
    }

    if (environment === "staging" && urgency === "critical") {
      return "high";
    }

    if (environment === "staging") {
      return "medium";
    }

    return urgency;
  }
}