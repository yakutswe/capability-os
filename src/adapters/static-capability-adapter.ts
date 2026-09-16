import type {
  AdapterEnvironment,
  AdapterHealth,
  CapabilityAdapter,
  OperationalCapability
} from "./capability-adapter.js";

export interface StaticAdapterConfiguration {
  id: string;
  vendor: string;
  capabilities: readonly OperationalCapability[];
  environments: readonly AdapterEnvironment[];
  readOnly: boolean;
  estimatedLatencyMs: number;
  estimatedCostUsd: number;
  health: AdapterHealth;
}

export class StaticCapabilityAdapter implements CapabilityAdapter {
  readonly id: string;
  readonly vendor: string;
  readonly capabilities: readonly OperationalCapability[];
  readonly environments: readonly AdapterEnvironment[];
  readonly readOnly: boolean;
  readonly estimatedLatencyMs: number;
  readonly estimatedCostUsd: number;

  private health: AdapterHealth;

  constructor(configuration: StaticAdapterConfiguration) {
    this.id = configuration.id;
    this.vendor = configuration.vendor;
    this.capabilities = configuration.capabilities;
    this.environments = configuration.environments;
    this.readOnly = configuration.readOnly;
    this.estimatedLatencyMs = configuration.estimatedLatencyMs;
    this.estimatedCostUsd = configuration.estimatedCostUsd;
    this.health = configuration.health;
  }

  async checkHealth(): Promise<AdapterHealth> {
    return this.health;
  }

  setHealth(health: AdapterHealth): void {
    this.health = health;
  }
}