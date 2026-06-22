import type { ProviderName } from '../../../../common';
import type { ProviderHealthState } from './routing.strategy';
import type { IHealthMonitor } from './health.monitor';

// ---------------------------------------------------------------------------
// NullHealthMonitor
//
// A no-op {@link IHealthMonitor} for per-request routers. A request-scoped
// router lives for the duration of a single request and is built from the
// caller's own credentials, so the interval-based boot-time health tracking is
// neither available nor meaningful. Returning an empty health map makes every
// provider read as optimistically healthy in the ProviderRouter (which treats a
// missing state as `healthy: true`), so the FixedOrderRoutingStrategy order is
// preserved exactly. checkProvider() is a no-op.
// ---------------------------------------------------------------------------

export class NullHealthMonitor implements IHealthMonitor {
  /** No tracked state — the router treats absent entries as healthy. */
  public getHealthStates(): ReadonlyMap<ProviderName, ProviderHealthState> {
    return new Map<ProviderName, ProviderHealthState>();
  }

  /** No-op: there is no background monitor to re-probe against. */
  public async checkProvider(_name: ProviderName): Promise<void> {
    // intentionally empty
  }
}
