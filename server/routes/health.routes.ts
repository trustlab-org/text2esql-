/**
 * Health check route for the Query Copilot plugin.
 *
 * Exposes `GET /api/query_copilot/health`, returning an aggregated health
 * report covering the Redis cache, the registered LLM providers, and the
 * overall query-generation pipeline. The core aggregation logic lives in the
 * pure {@link buildHealthReport} function so it can be unit-tested in
 * isolation from the HTTP layer.
 */

import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { ProviderRoutingState } from '../services/providers';
import { PLUGIN_ROUTE_PREFIX, HEALTH_STATUS } from '../../common';

/**
 * Health status for an individual component of the system.
 */
export type ComponentStatus = 'healthy' | 'degraded' | 'unhealthy';

/**
 * Health of a single component, paired with a human-readable explanation.
 */
export interface ComponentHealth {
  /** The component's current health status. */
  readonly status: ComponentStatus;
  /** A human-readable explanation of the status. */
  readonly detail: string;
}

/**
 * Aggregated health report for the Query Copilot plugin.
 */
export interface HealthReport {
  /** The overall status, derived from the component statuses. */
  readonly status: ComponentStatus;
  /** Per-component health breakdown. */
  readonly components: {
    /** Health of the Redis cache. */
    readonly redis: ComponentHealth;
    /** Health of the registered LLM providers. */
    readonly providers: ComponentHealth;
    /** Health of the overall query-generation pipeline. */
    readonly pipeline: ComponentHealth;
  };
}

/**
 * Builds an aggregated {@link HealthReport} from the current provider routing
 * state and Redis availability.
 *
 * This is a pure function: given the same inputs it always returns the same
 * output and performs no I/O, which makes it straightforward to unit-test.
 *
 * @param state - The current provider routing state (registered providers only).
 * @param redisAvailable - Whether the Redis cache is currently ready.
 * @returns The aggregated health report.
 */
export function buildHealthReport(
  state: ProviderRoutingState,
  redisAvailable: boolean
): HealthReport {
  const total = state.providers.length;
  const healthyCount = state.providers.filter((p) => p.healthy).length;

  let providers: ComponentHealth;
  if (total === 0) {
    providers = { status: 'unhealthy', detail: 'No providers are registered.' };
  } else if (healthyCount === 0) {
    providers = { status: 'unhealthy', detail: `All ${total} provider(s) are down.` };
  } else if (healthyCount < total) {
    providers = { status: 'degraded', detail: `${healthyCount}/${total} providers healthy.` };
  } else {
    providers = { status: 'healthy', detail: `All ${total} providers healthy.` };
  }

  const redis: ComponentHealth = redisAvailable
    ? { status: 'healthy', detail: 'Redis connection ready.' }
    : {
        status: 'degraded',
        detail: 'Redis unavailable; caching disabled but the pipeline remains functional.',
      };

  const pipeline: ComponentHealth =
    healthyCount > 0
      ? { status: 'healthy', detail: 'Pipeline operational.' }
      : {
          status: 'unhealthy',
          detail: 'Pipeline cannot generate queries: no healthy providers.',
        };

  let status: ComponentStatus;
  if (healthyCount === 0) {
    status = HEALTH_STATUS.UNHEALTHY;
  } else if (healthyCount < total || !redisAvailable) {
    status = HEALTH_STATUS.DEGRADED;
  } else {
    status = HEALTH_STATUS.HEALTHY;
  }

  return { status, components: { redis, providers, pipeline } };
}

/**
 * Registers the Query Copilot health route on the given router.
 *
 * @param router - The Kibana router to register the route on.
 * @param context - The Query Copilot plugin context providing routing,
 *   caching, and logging services.
 */
export function registerHealthRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/health`,
      validate: false,
      options: { authRequired: true, tags: ['access:queryCopilot'] },
    },
    async (_ctx, request, response) => {
      context.logger.logRequest(
        (request.headers['x-request-id'] as string) ?? 'health',
        'GET',
        request.url.pathname
      );
      const report = buildHealthReport(
        context.router.getCurrentRouteState(),
        context.cacheService.isAvailable()
      );
      return response.ok({ body: report });
    }
  );
}
