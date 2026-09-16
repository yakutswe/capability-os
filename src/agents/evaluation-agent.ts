import { z } from "zod";

import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types/agent.js";

const evaluationInputSchema = z.object({
  workflowId: z.string().min(1),

  discovery: z.object({
    status: z.enum(["completed", "needs_input", "blocked"]),
    successCriteriaCount: z.number().int().nonnegative(),
    constraintCount: z.number().int().nonnegative(),
    riskLevel: z.enum(["low", "medium", "high", "critical"]),
    requiresHumanApproval: z.boolean()
  }),

  integration: z.object({
    status: z.enum(["completed", "needs_input", "blocked"]),
    requiredCapabilities: z.number().int().positive(),
    resolvedCapabilities: z.number().int().nonnegative(),
    fallbackProtectedCapabilities: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    maximumLatencyMs: z.number().nonnegative()
  }),

  policy: z.object({
    decision: z.enum(["allow", "approval_required", "deny"]),
    violationsCount: z.number().int().nonnegative(),
    auditRequired: z.boolean()
  }),

  thresholds: z.object({
    minimumOverallScore: z.number().min(0).max(100).default(80),
    maximumCostUsd: z.number().positive().default(0.5),
    maximumLatencyMs: z.number().positive().default(500),
    minimumFallbackCoverage: z.number().min(0).max(1).default(0.5)
  })
});

const evaluationOutputSchema = z.object({
  workflowId: z.string(),
  passed: z.boolean(),

  scores: z.object({
    safety: z.number(),
    completeness: z.number(),
    resilience: z.number(),
    efficiency: z.number(),
    overall: z.number()
  }),

  metrics: z.object({
    capabilityResolutionRate: z.number(),
    fallbackCoverage: z.number(),
    estimatedCostUsd: z.number(),
    maximumLatencyMs: z.number()
  }),

  failures: z.array(z.string()),
  recommendations: z.array(z.string())
});

type EvaluationInput = z.infer<typeof evaluationInputSchema>;

export type EvaluationOutput = z.infer<
  typeof evaluationOutputSchema
>;

export class EvaluationAgent
  implements Agent<unknown, EvaluationOutput>
{
  readonly name = "evaluation-agent";

  async run(
    input: unknown,
    context: AgentContext
  ): Promise<AgentResult<EvaluationOutput>> {
    const parsedInput = evaluationInputSchema.safeParse(input);

    if (!parsedInput.success) {
      return {
        agent: this.name,
        status: "needs_input",
        reasoning: [
          "The evaluation request failed structured-input validation."
        ],
        warnings: parsedInput.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`
        )
      };
    }

    const request = parsedInput.data;
    const failures: string[] = [];
    const recommendations: string[] = [];

    const capabilityResolutionRate = Math.min(
      1,
      request.integration.resolvedCapabilities /
        request.integration.requiredCapabilities
    );

    const fallbackCoverage = Math.min(
      1,
      request.integration.fallbackProtectedCapabilities /
        request.integration.requiredCapabilities
    );

    const safety = this.calculateSafetyScore(
      request,
      failures,
      recommendations
    );

    const completeness = this.calculateCompletenessScore(
      request,
      failures,
      recommendations
    );

    const resilience = this.calculateResilienceScore(
      request,
      capabilityResolutionRate,
      fallbackCoverage,
      failures,
      recommendations
    );

    const efficiency = this.calculateEfficiencyScore(
      request,
      failures,
      recommendations
    );

    const overall = this.round(
      safety * 0.35 +
      completeness * 0.25 +
      resilience * 0.25 +
      efficiency * 0.15
    );

    if (overall < request.thresholds.minimumOverallScore) {
      failures.push(
        `Overall score ${overall} is below the required ` +
        `${request.thresholds.minimumOverallScore}.`
      );
    }

    const passed = failures.length === 0;

    const output = evaluationOutputSchema.parse({
      workflowId: request.workflowId,
      passed,
      scores: {
        safety,
        completeness,
        resilience,
        efficiency,
        overall
      },
      metrics: {
        capabilityResolutionRate: this.round(
          capabilityResolutionRate
        ),
        fallbackCoverage: this.round(fallbackCoverage),
        estimatedCostUsd:
          request.integration.estimatedCostUsd,
        maximumLatencyMs:
          request.integration.maximumLatencyMs
      },
      failures: [...new Set(failures)],
      recommendations: [...new Set(recommendations)]
    });

    return {
      agent: this.name,
      status: "completed",
      data: output,
      reasoning: [
        `Evaluated workflow ${request.workflowId}.`,
        `Calculated overall score ${overall}.`,
        `Evaluation request ${context.requestId} completed.`
      ],
      warnings: passed
        ? []
        : ["The workflow did not meet production-readiness thresholds."]
    };
  }

  private calculateSafetyScore(
    request: EvaluationInput,
    failures: string[],
    recommendations: string[]
  ): number {
    let score = 100;

    if (request.policy.decision === "deny") {
      score = 0;
      failures.push("The Policy Agent denied the workflow.");
      recommendations.push(
        "Resolve all policy violations before execution."
      );
    }

    if (request.policy.violationsCount > 0) {
      score -= Math.min(
        100,
        request.policy.violationsCount * 25
      );

      failures.push("Unresolved policy violations remain.");
    }

    if (
      request.discovery.riskLevel === "critical" &&
      !request.discovery.requiresHumanApproval
    ) {
      score -= 60;
      failures.push(
        "Critical-risk work is missing a human approval requirement."
      );
      recommendations.push(
        "Add an exact-action approval gate."
      );
    }

    if (!request.policy.auditRequired) {
      score -= 30;
      failures.push("The workflow does not require audit logging.");
      recommendations.push(
        "Enable append-only audit logging."
      );
    }

    return this.clamp(score);
  }

  private calculateCompletenessScore(
    request: EvaluationInput,
    failures: string[],
    recommendations: string[]
  ): number {
    let score =
      request.discovery.status === "completed" ? 40 : 0;

    score += Math.min(
      30,
      request.discovery.successCriteriaCount * 10
    );

    score += Math.min(
      30,
      request.discovery.constraintCount * 10
    );

    if (request.discovery.status !== "completed") {
      failures.push("Discovery is incomplete.");
      recommendations.push(
        "Resolve missing customer requirements."
      );
    }

    return this.clamp(score);
  }

  private calculateResilienceScore(
    request: EvaluationInput,
    resolutionRate: number,
    fallbackCoverage: number,
    failures: string[],
    recommendations: string[]
  ): number {
    const score =
      (request.integration.status === "completed" ? 50 : 0) +
      resolutionRate * 25 +
      fallbackCoverage * 25;

    if (
      request.integration.status !== "completed" ||
      resolutionRate < 1
    ) {
      failures.push(
        "Not all required capabilities have an eligible adapter."
      );
    }

    if (
      fallbackCoverage <
      request.thresholds.minimumFallbackCoverage
    ) {
      failures.push(
        "Fallback coverage is below the required threshold."
      );

      recommendations.push(
        "Add backup adapters for critical capabilities."
      );
    }

    return this.clamp(score);
  }

  private calculateEfficiencyScore(
    request: EvaluationInput,
    failures: string[],
    recommendations: string[]
  ): number {
    const costRatio =
      request.integration.estimatedCostUsd /
      request.thresholds.maximumCostUsd;

    const latencyRatio =
      request.integration.maximumLatencyMs /
      request.thresholds.maximumLatencyMs;

    if (costRatio > 1) {
      failures.push("Estimated cost exceeds the allowed threshold.");
      recommendations.push(
        "Select a lower-cost adapter or reduce unnecessary calls."
      );
    }

    if (latencyRatio > 1) {
      failures.push("Estimated latency exceeds the allowed threshold.");
      recommendations.push(
        "Select a faster adapter or parallelize safe operations."
      );
    }

    const costScore = Math.max(0, 100 - costRatio * 50);
    const latencyScore = Math.max(
      0,
      100 - latencyRatio * 50
    );

    return this.clamp((costScore + latencyScore) / 2);
  }

  private clamp(value: number): number {
    return this.round(Math.max(0, Math.min(100, value)));
  }

  private round(value: number): number {
    return Math.round(value * 100) / 100;
  }
}