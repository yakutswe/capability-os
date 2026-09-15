export type AgentStatus = "completed" | "needs_input" | "blocked";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface AgentContext {
  requestId: string;
  timestamp: string;
  userId?: string;
  metadata: Record<string, unknown>;
}

export interface AgentResult<TOutput> {
  agent: string;
  status: AgentStatus;
  data?: TOutput;
  reasoning: string[];
  warnings: string[];
}

export interface Agent<TInput, TOutput> {
  readonly name: string;

  run(
    input: TInput,
    context: AgentContext
  ): Promise<AgentResult<TOutput>>;
}