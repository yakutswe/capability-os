import { z } from "zod";

import type {
  Agent,
  AgentContext,
  AgentResult,
  RiskLevel
} from "../types/agent.js";

const actorRoleSchema = z.enum([
  "viewer",
  "incident-responder",
  "operator",
  "approver",
  "security-reviewer"
]);

const dataClassificationSchema = z.enum([
  "public",
  "internal",
  "confidential",
  "restricted"
]);

const policyInputSchema = z.object({
  operationId: z.string().min(1),

  action: z.enum([
    "search-runbook",
    "read-logs",
    "read-metrics",
    "read-deployment",
    "rollback",
    "restart-service",
    "update-configuration"
  ]),

  environment: z.enum([
    "development",
    "staging",
    "production"
  ]),

  mutating: z.boolean(),

  actor: z.object({
    id: z.string().min(1),
    roles: z.array(actorRoleSchema).min(1)
  }),

  requestedResources: z.array(z.string().min(1)).min(1),

  dataClassifications: z
    .array(dataClassificationSchema)
    .min(1),

  containsSecrets: z.boolean().default(false)
});

const policyDecisionSchema = z.object({
  decision: z.enum([
    "allow",
    "approval_required",
    "deny"
  ]),

  policyVersion: z.string(),
  riskLevel: z.enum([
    "low",
    "medium",
    "high",
    "critical"
  ]),

  requiresHumanApproval: z.boolean(),
  requiredRoles: z.array(actorRoleSchema),
  redactions: z.array(z.string()),
  violations: z.array(z.string()),
  auditRequired: z.boolean()
});

type ActorRole = z.infer<typeof actorRoleSchema>;
type PolicyInput = z.infer<typeof policyInputSchema>;

export type PolicyDecision = z.infer<
  typeof policyDecisionSchema
>;

export class PolicyAgent
  implements Agent<unknown, PolicyDecision>
{
  readonly name = "policy-agent";
  readonly policyVersion = "2026-09-16";

  async run(
    input: unknown,
    context: AgentContext
  ): Promise<AgentResult<PolicyDecision>> {
    const parsedInput = policyInputSchema.safeParse(input);

    if (!parsedInput.success) {
      return {
        agent: this.name,
        status: "needs_input",
        reasoning: [
          "The policy request failed structured-input validation."
        ],
        warnings: parsedInput.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`
        )
      };
    }

    const request = parsedInput.data;
    const requiredRoles = this.determineRequiredRoles(request);
    const violations: string[] = [];
    const redactions: string[] = [];

    if (
      request.environment === "production" &&
      !request.actor.roles.includes("incident-responder")
    ) {
      violations.push(
        "Production access requires the incident-responder role."
      );
    }

    if (
      request.mutating &&
      !request.actor.roles.includes("operator")
    ) {
      violations.push(
        "Mutating operations require the operator role."
      );
    }

    if (
      request.dataClassifications.includes("restricted") &&
      !request.actor.roles.includes("security-reviewer")
    ) {
      violations.push(
        "Restricted data requires the security-reviewer role."
      );
    }

    if (request.containsSecrets) {
      redactions.push(
        "access tokens",
        "passwords",
        "API keys",
        "payment credentials"
      );
    }

    if (
      request.dataClassifications.includes("confidential") ||
      request.dataClassifications.includes("restricted")
    ) {
      redactions.push(
        "customer identifiers",
        "personal information"
      );
    }

    const riskLevel = this.determineRiskLevel(request);

    const requiresHumanApproval =
      request.environment === "production" &&
      request.mutating &&
      violations.length === 0;

    const decision =
      violations.length > 0
        ? "deny"
        : requiresHumanApproval
          ? "approval_required"
          : "allow";

    const policyDecision = policyDecisionSchema.parse({
      decision,
      policyVersion: this.policyVersion,
      riskLevel,
      requiresHumanApproval,
      requiredRoles,
      redactions: [...new Set(redactions)],
      violations,
      auditRequired: true
    });

    return {
      agent: this.name,
      status:
        decision === "deny"
          ? "blocked"
          : decision === "approval_required"
            ? "needs_input"
            : "completed",
      data: policyDecision,
      reasoning: [
        `Evaluated operation ${request.operationId}.`,
        `Applied policy version ${this.policyVersion}.`,
        `Recorded policy request ${context.requestId}.`,
        `Final policy decision: ${decision}.`
      ],
      warnings:
        decision === "approval_required"
          ? [
              "Execution must remain blocked until an authorized human approves the exact action."
            ]
          : violations
    };
  }

  private determineRequiredRoles(
    request: PolicyInput
  ): ActorRole[] {
    const requiredRoles: ActorRole[] = [];

    if (request.environment === "production") {
      requiredRoles.push("incident-responder");
    }

    if (request.mutating) {
      requiredRoles.push("operator");
    }

    if (
      request.dataClassifications.includes("restricted")
    ) {
      requiredRoles.push("security-reviewer");
    }

    return [...new Set(requiredRoles)];
  }

  private determineRiskLevel(
    request: PolicyInput
  ): RiskLevel {
    if (
      request.environment === "production" &&
      request.mutating
    ) {
      return "critical";
    }

    if (
      request.environment === "production" ||
      request.dataClassifications.includes("restricted")
    ) {
      return "high";
    }

    if (
      request.environment === "staging" ||
      request.mutating ||
      request.dataClassifications.includes("confidential")
    ) {
      return "medium";
    }

    return "low";
  }
}