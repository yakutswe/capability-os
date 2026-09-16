export type OperationalCapability =
  | "log-search"
  | "runbook-search"
  | "deployment-read"
  | "metrics-read"
  | "rollback";

export type AdapterEnvironment =
  | "development"
  | "staging"
  | "production";

export type AdapterHealth =
  | "healthy"
  | "degraded"
  | "unavailable";

export interface CapabilityAdapter {
  readonly id: string;
  readonly vendor: string;
  readonly capabilities: readonly OperationalCapability[];
  readonly environments: readonly AdapterEnvironment[];
  readonly readOnly: boolean;
  readonly estimatedLatencyMs: number;
  readonly estimatedCostUsd: number;

  checkHealth(): Promise<AdapterHealth>;
}