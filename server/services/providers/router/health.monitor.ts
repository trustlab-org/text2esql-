import type { Logger } from '@kbn/core/server';
import type { ProviderName } from '../../../../common';
import type { ILLMProvider } from '../types';
import type { ProviderHealthState } from './routing.strategy';

// ---------------------------------------------------------------------------
// HealthMonitorConfig
// ---------------------------------------------------------------------------

export interface HealthMonitorConfig {
  /**
   * Interval in milliseconds between health check sweeps.
   * Default: 60_000 (60 seconds)
   */
  readonly intervalMs: number;
  /**
   * Number of consecutive failures before a provider is marked unhealthy.
   * Default: 2 — avoids flapping on a single transient failure.
   */
  readonly failureThreshold: number;
  /**
   * Number of consecutive successes required to recover a provider
   * from unhealthy → healthy.
   * Default: 1 — recover immediately on first success.
   */
  readonly recoveryThreshold: number;
}

export const DEFAULT_HEALTH_MONITOR_CONFIG: HealthMonitorConfig = {
  intervalMs: 60_000,
  failureThreshold: 2,
  recoveryThreshold: 1,
};

// ---------------------------------------------------------------------------
// Internal mutable health record (never exposed directly)
// ---------------------------------------------------------------------------

interface MutableHealthRecord {
  healthy: boolean;
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

function initialRecord(): MutableHealthRecord {
  return {
    healthy: true, // optimistic until first check
    lastCheckedAt: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };
}

// ---------------------------------------------------------------------------
// HealthMonitor
//
// Responsibilities:
//  - Run isHealthy() probes on all registered providers at a configurable interval.
//  - Maintain a ProviderHealthState map accessible synchronously by the router.
//  - Apply hysteresis: failureThreshold consecutive failures → unhealthy;
//    recoveryThreshold consecutive successes → healthy.
//  - Never throw from the interval callback — log errors, update state.
//  - start() / stop() for lifecycle management (called from plugin setup/stop).
//
// Thread safety: Node.js is single-threaded; no locking needed.
// ---------------------------------------------------------------------------

export class HealthMonitor {
  private readonly providers: ReadonlyMap<ProviderName, ILLMProvider>;
  private readonly config: HealthMonitorConfig;
  private readonly logger: Logger;

  private readonly records = new Map<ProviderName, MutableHealthRecord>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    providers: ReadonlyMap<ProviderName, ILLMProvider>,
    logger: Logger,
    config: Partial<HealthMonitorConfig> = {}
  ) {
    this.providers = providers;
    this.logger = logger;
    this.config = { ...DEFAULT_HEALTH_MONITOR_CONFIG, ...config };

    // Seed records with optimistic state for every registered provider
    for (const name of providers.keys()) {
      this.records.set(name, initialRecord());
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Starts the health check interval and runs an immediate sweep so the
   * router has real data before the first interval fires.
   */
  public start(): void {
    if (this.running) return;
    this.running = true;

    // Immediate sweep — do not block start() on it
    void this.runSweep();

    this.intervalHandle = setInterval(() => {
      void this.runSweep();
    }, this.config.intervalMs);

    this.logger.info(
      `HealthMonitor started — interval=${this.config.intervalMs}ms, ` +
        `failureThreshold=${this.config.failureThreshold}, ` +
        `recoveryThreshold=${this.config.recoveryThreshold}`
    );
  }

  /**
   * Stops the interval. Safe to call multiple times.
   */
  public stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.running = false;
    this.logger.info('HealthMonitor stopped');
  }

  // ── Public read API ───────────────────────────────────────────────────────

  /**
   * Returns a frozen snapshot of all provider health states.
   * Safe to call from the router at any time — O(n) copy.
   */
  public getHealthStates(): ReadonlyMap<ProviderName, ProviderHealthState> {
    const snapshot = new Map<ProviderName, ProviderHealthState>();
    for (const [name, record] of this.records) {
      snapshot.set(name, this.toPublicState(name, record));
    }
    return snapshot;
  }

  /**
   * Returns the health state for a single provider.
   * Returns optimistic (healthy: true) if the provider is not registered.
   */
  public getHealthState(name: ProviderName): ProviderHealthState {
    const record = this.records.get(name);
    if (!record) {
      return {
        name,
        healthy: true,
        lastCheckedAt: null,
        consecutiveFailures: 0,
      };
    }
    return this.toPublicState(name, record);
  }

  /**
   * Forces an immediate health check for a single provider.
   * Useful after a provider error to re-validate before the next sweep.
   */
  public async checkProvider(name: ProviderName): Promise<ProviderHealthState> {
    const provider = this.providers.get(name);
    if (!provider) {
      return this.getHealthState(name);
    }
    await this.probeProvider(name, provider);
    return this.getHealthState(name);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Runs a concurrent health probe across all registered providers.
   * Failures are caught per-provider — one failure never blocks others.
   */
  private async runSweep(): Promise<void> {
    const probes = Array.from(this.providers.entries()).map(([name, provider]) =>
      this.probeProvider(name, provider).catch((err) => {
        // probeProvider already handles errors internally; this catch is defensive
        this.logger.warn(`HealthMonitor: unexpected error probing ${name}: ${String(err)}`);
      })
    );

    await Promise.allSettled(probes);
    this.logger.debug(
      `HealthMonitor sweep complete — ${this.summarizeHealth()}`
    );
  }

  /**
   * Probes a single provider and updates its health record with hysteresis.
   */
  private async probeProvider(name: ProviderName, provider: ILLMProvider): Promise<void> {
    let isHealthy = false;

    try {
      isHealthy = await provider.isHealthy();
    } catch {
      // isHealthy() contract: must not throw — but we defend anyway
      isHealthy = false;
    }

    const record = this.records.get(name) ?? initialRecord();
    const wasHealthy = record.healthy;
    const now = new Date().toISOString();

    if (isHealthy) {
      record.consecutiveFailures = 0;
      record.consecutiveSuccesses += 1;

      if (!wasHealthy && record.consecutiveSuccesses >= this.config.recoveryThreshold) {
        record.healthy = true;
        this.logger.info(`HealthMonitor: provider "${name}" recovered (healthy)`);
      }
    } else {
      record.consecutiveSuccesses = 0;
      record.consecutiveFailures += 1;

      if (wasHealthy && record.consecutiveFailures >= this.config.failureThreshold) {
        record.healthy = false;
        this.logger.warn(
          `HealthMonitor: provider "${name}" marked unhealthy ` +
            `(${record.consecutiveFailures} consecutive failures)`
        );
      }
    }

    record.lastCheckedAt = now;
    this.records.set(name, record);
  }

  private toPublicState(name: ProviderName, record: MutableHealthRecord): ProviderHealthState {
    return Object.freeze<ProviderHealthState>({
      name,
      healthy: record.healthy,
      lastCheckedAt: record.lastCheckedAt,
      consecutiveFailures: record.consecutiveFailures,
    });
  }

  private summarizeHealth(): string {
    const parts: string[] = [];
    for (const [name, record] of this.records) {
      parts.push(`${name}=${record.healthy ? 'ok' : 'unhealthy'}`);
    }
    return parts.join(', ');
  }
}