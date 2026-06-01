/**
 * Provider status route for the Query Copilot plugin.
 *
 * Exposes the current routing state of registered (enabled) LLM providers,
 * enriched with per-provider configuration (model, enabled flag) from the
 * {@link ConfigService}.
 */

import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { ProviderRoutingState } from '../services/providers';
import type { ConfigService } from '../services';
import type { ProviderName } from '../../common';
import { PLUGIN_ROUTE_PREFIX } from '../../common';

/**
 * Public shape of a single provider's status as returned by the providers route.
 */
export interface ProviderStatus {
  readonly name: ProviderName;
  readonly role: string;
  readonly priority: number;
  readonly healthy: boolean;
  /** ISO timestamp of the last health check, or `''` when never checked. */
  readonly lastCheckedAt: string;
  readonly model: string;
  readonly enabled: boolean;
}

/**
 * Pure mapper that combines the live routing state with configuration to
 * produce the public {@link ProviderStatus} list.
 *
 * @param state - Current routing state (registered providers only).
 * @param config - Configuration service used to resolve model and enabled flag.
 * @returns One {@link ProviderStatus} per registered provider.
 */
export function buildProviderStatuses(
  state: ProviderRoutingState,
  config: ConfigService
): ProviderStatus[] {
  return state.providers.map((p) => ({
    name: p.name,
    role: p.role,
    priority: p.priority,
    healthy: p.healthy,
    lastCheckedAt: p.lastCheckedAt ?? '',
    model: config.getProviderModel(p.name),
    enabled: config.isProviderEnabled(p.name),
  }));
}

/**
 * Registers the GET `/providers` route, which reports the status of all
 * registered providers.
 *
 * @param router - The plugin's HTTP router.
 * @param context - The Query Copilot plugin context.
 */
export function registerProviderRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/providers`,
      validate: false,
      options: { authRequired: true, tags: ['access:queryCopilot'] },
    },
    async (_ctx, request, response) => {
      context.logger.logRequest(
        (request.headers['x-request-id'] as string) ?? 'providers',
        'GET',
        request.url.pathname
      );
      const providers = buildProviderStatuses(
        context.router.getCurrentRouteState(),
        context.config
      );
      return response.ok({ body: { providers } });
    }
  );
}
