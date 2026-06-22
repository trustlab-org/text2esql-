import type { ProviderName } from '../../../common';
import type { RequestCredentials } from '../../../common/types';
import type { LoggerService } from '../observability';
import { ProviderFactory } from './provider.factory';
import { ProviderRouter } from './router';
import { NullHealthMonitor } from './router';
import { FixedOrderRoutingStrategy } from './router';

// ---------------------------------------------------------------------------
// buildRequestRouter
//
// Constructs a per-request ProviderRouter from the caller's own credentials.
// The router is built fresh for the request and discarded afterwards: it has no
// background health monitor (NullHealthMonitor) and routes in the caller's
// explicit primary→fallback order (FixedOrderRoutingStrategy). API keys flow
// only through the ProviderFactory into the concrete providers — they are never
// logged here.
// ---------------------------------------------------------------------------

/**
 * Builds a request-scoped {@link ProviderRouter} from {@link RequestCredentials}.
 *
 * The provider map is built by {@link ProviderFactory.createProviderMap}
 * (primary then fallback, deduped). The routing order is the primary followed
 * by the fallback provider, deduplicated so a same-provider fallback does not
 * appear twice. Health is intentionally not tracked — a {@link NullHealthMonitor}
 * makes every provider read as healthy so the fixed order is honoured exactly.
 */
export function buildRequestRouter(
  creds: RequestCredentials,
  logger: LoggerService
): ProviderRouter {
  const map = new ProviderFactory().createProviderMap(creds);

  const order: ProviderName[] = [];
  const seen = new Set<ProviderName>();
  for (const provider of [creds.primary.provider, creds.fallback?.provider]) {
    if (provider && !seen.has(provider)) {
      order.push(provider);
      seen.add(provider);
    }
  }

  return new ProviderRouter(
    map,
    new NullHealthMonitor(),
    new FixedOrderRoutingStrategy(order),
    logger
  );
}
