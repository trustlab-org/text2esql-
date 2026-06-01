import type { ProviderName } from '../../../../common';
import type { ILLMProvider } from '../types';

// ---------------------------------------------------------------------------
// ProviderHealthState — what the strategy sees about each provider
// ---------------------------------------------------------------------------

export interface ProviderHealthState {
  readonly name: ProviderName;
  readonly healthy: boolean;
  readonly lastCheckedAt: string | null; // ISO 8601
  readonly consecutiveFailures: number;
}

// ---------------------------------------------------------------------------
// IRoutingStrategy
// ---------------------------------------------------------------------------

export interface IRoutingStrategy {
  /**
   * Returns an ordered list of providers to attempt, given the current health map.
   * The router will attempt them left-to-right, skipping unhealthy entries
   * only if filterUnhealthy is true.
   *
   * Implementations must be pure — no side effects, no I/O.
   */
  order(
    providers: ReadonlyMap<ProviderName, ILLMProvider>,
    healthStates: ReadonlyMap<ProviderName, ProviderHealthState>
  ): ProviderName[];
}

// ---------------------------------------------------------------------------
// Role tier ordering — primary < fallback < local
// Lower number = tried first
// ---------------------------------------------------------------------------

const ROLE_TIER: Record<string, number> = {
  primary: 0,
  fallback: 1,
  local: 2,
};

// ---------------------------------------------------------------------------
// PriorityRoutingStrategy
//
// Orders providers by:
//   1. Role tier (primary → fallback → local)
//   2. Priority within tier (lower number = higher priority)
//   3. Healthy-first within same tier+priority (unhealthy pushed to end)
//
// Unhealthy providers are NOT filtered out here — the router decides whether
// to skip them. Including them allows the router to attempt an unhealthy
// provider as a last resort when all healthy options are exhausted.
// ---------------------------------------------------------------------------

export class PriorityRoutingStrategy implements IRoutingStrategy {
  public order(
    providers: ReadonlyMap<ProviderName, ILLMProvider>,
    healthStates: ReadonlyMap<ProviderName, ProviderHealthState>
  ): ProviderName[] {
    const entries = Array.from(providers.entries()).map(([name, provider]) => {
      const metadata = provider.getMetadata();
      const health = healthStates.get(name);
      return {
        name,
        roleTier: ROLE_TIER[metadata.role] ?? 99,
        priority: metadata.priority,
        healthy: health?.healthy ?? true, // assume healthy if not yet checked
      };
    });

    entries.sort((a, b) => {
      // 1. Role tier
      if (a.roleTier !== b.roleTier) return a.roleTier - b.roleTier;
      // 2. Priority within tier
      if (a.priority !== b.priority) return a.priority - b.priority;
      // 3. Healthy first
      if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
      return 0;
    });

    return entries.map((e) => e.name);
  }
}