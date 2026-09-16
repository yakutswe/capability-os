import { z } from "zod";

import type {
  AdapterHealth,
  CapabilityAdapter,
  OperationalCapability
} from "../adapters/capability-adapter.js";

import type {
  Agent,
  AgentContext,
  AgentResult
} from "../types/agent.js";

const capabilitySchema = z.enum([
  "log-search",
  "runbook-search",
  "deployment-read",
  "metrics-read",
  "rollback"
]);

const integrationInputSchema = z.object({
  requiredCapabilities: z.array(capabilitySchema).min(1),
  environment: z.enum(["development", "staging", "production"]),
  requireReadOnly: z.boolean().default(true),
  maxLatencyMs: z.number().positive().default(2000),
  maxCostUsd: z.number().nonnegative().default(1)
});

const integrationPlanSchema = z.object({
  environment: z.enum(["development", "staging", "production"]),
  selections: z.array(
    z.object({
      capability: capabilitySchema,
      primaryAdapter: z.string(),
      fallbackAdapter: z.string().optional(),
      rationale: z.string()
    })
  ),
  unresolvedCapabilities: z.array(capabilitySchema),
  estimatedTotalCostUsd: z.number(),
  maximumEstimatedLatencyMs: z.number()
});

export type IntegrationPlan = z.infer<typeof integrationPlanSchema>;

interface RankedCandidate {
  adapter: CapabilityAdapter;
  health: AdapterHealth;
}

export class IntegrationAgent
  implements Agent<unknown, IntegrationPlan>
{
  readonly name = "integration-agent";

  constructor(
    private readonly adapters: readonly CapabilityAdapter[]
  ) {}

  async run(
    input: unknown,
    context: AgentContext
  ): Promise<AgentResult<IntegrationPlan>> {
    const parsedInput = integrationInputSchema.safeParse(input);

    if (!parsedInput.success) {
      return {
        agent: this.name,
        status: "needs_input",
        reasoning: [
          "The integration request failed structured-input validation."
        ],
        warnings: parsedInput.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`
        )
      };
    }

    const request = parsedInput.data;
    const healthByAdapter = new Map<string, AdapterHealth>();

    for (const adapter of this.adapters) {
      healthByAdapter.set(
        adapter.id,
        await adapter.checkHealth()
      );
    }

    const selections: IntegrationPlan["selections"] = [];
    const unresolvedCapabilities: OperationalCapability[] = [];
    const warnings: string[] = [];

    for (const capability of request.requiredCapabilities) {
      const candidates = this.rankCandidates(
        capability,
        request,
        healthByAdapter
      );

      const primary = candidates[0];

      if (!primary) {
        unresolvedCapabilities.push(capability);
        warnings.push(
          `No eligible adapter is available for ${capability}.`
        );
        continue;
      }

      const fallback = candidates[1];

      selections.push({
        capability,
        primaryAdapter: primary.adapter.id,
        fallbackAdapter: fallback?.adapter.id,
        rationale:
          `${primary.adapter.id} was selected because it is ` +
          `${primary.health}, supports ${request.environment}, ` +
          `costs approximately $${primary.adapter.estimatedCostUsd}, ` +
          `and has estimated latency of ` +
          `${primary.adapter.estimatedLatencyMs}ms.`
      });

      if (primary.health === "degraded") {
        warnings.push(
          `${primary.adapter.id} is degraded; fallback routing should remain active.`
        );
      }
    }

    const estimatedTotalCostUsd = selections.reduce(
      (total, selection) => {
        const adapter = this.adapters.find(
          (candidate) => candidate.id === selection.primaryAdapter
        );

        return total + (adapter?.estimatedCostUsd ?? 0);
      },
      0
    );

    const maximumEstimatedLatencyMs = selections.reduce(
      (maximum, selection) => {
        const adapter = this.adapters.find(
          (candidate) => candidate.id === selection.primaryAdapter
        );

        return Math.max(
          maximum,
          adapter?.estimatedLatencyMs ?? 0
        );
      },
      0
    );

    const plan = integrationPlanSchema.parse({
      environment: request.environment,
      selections,
      unresolvedCapabilities,
      estimatedTotalCostUsd,
      maximumEstimatedLatencyMs
    });

    return {
      agent: this.name,
      status:
        unresolvedCapabilities.length === 0
          ? "completed"
          : "blocked",
      data: plan,
      reasoning: [
        `Evaluated ${this.adapters.length} adapters.`,
        `Planned ${selections.length} required capabilities.`,
        `Request ${context.requestId} remains vendor-independent.`
      ],
      warnings
    };
  }

  private rankCandidates(
    capability: OperationalCapability,
    request: z.infer<typeof integrationInputSchema>,
    healthByAdapter: ReadonlyMap<string, AdapterHealth>
  ): RankedCandidate[] {
    const healthRank: Record<AdapterHealth, number> = {
      healthy: 0,
      degraded: 1,
      unavailable: 2
    };

    return this.adapters
      .map((adapter) => ({
        adapter,
        health:
          healthByAdapter.get(adapter.id) ?? "unavailable"
      }))
      .filter(({ adapter, health }) => {
        return (
          health !== "unavailable" &&
          adapter.capabilities.includes(capability) &&
          adapter.environments.includes(request.environment) &&
          (!request.requireReadOnly || adapter.readOnly) &&
          adapter.estimatedLatencyMs <= request.maxLatencyMs &&
          adapter.estimatedCostUsd <= request.maxCostUsd
        );
      })
      .sort((left, right) => {
        return (
          healthRank[left.health] - healthRank[right.health] ||
          left.adapter.estimatedCostUsd -
            right.adapter.estimatedCostUsd ||
          left.adapter.estimatedLatencyMs -
            right.adapter.estimatedLatencyMs
        );
      });
  }
}