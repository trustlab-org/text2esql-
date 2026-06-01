/**
 * Unit tests for the Query Copilot health route and its pure aggregation
 * logic, {@link buildHealthReport}.
 */

import { buildHealthReport, registerHealthRoutes } from './health.routes';
import type { ProviderRoutingState } from '../services/providers';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';

/**
 * Builds a {@link ProviderRoutingState} from a list of provider health flags.
 *
 * @param flags - One boolean per provider indicating whether it is healthy.
 * @returns A routing state with one provider per flag.
 */
function stateWith(flags: boolean[]): ProviderRoutingState {
  return {
    activeProvider: null,
    providers: flags.map((healthy, i) => ({
      name: 'openai',
      healthy,
      lastCheckedAt: null,
      consecutiveFailures: 0,
      role: 'primary',
      priority: i,
    })),
  } as unknown as ProviderRoutingState;
}

describe('buildHealthReport', () => {
  it('reports healthy when all providers are healthy and redis is available', () => {
    const report = buildHealthReport(stateWith([true, true]), true);
    expect(report.status).toBe('healthy');
    expect(report.components.redis.status).toBe('healthy');
    expect(report.components.providers.status).toBe('healthy');
    expect(report.components.pipeline.status).toBe('healthy');
  });

  it('reports degraded when some providers are down but redis is available', () => {
    const report = buildHealthReport(stateWith([true, false]), true);
    expect(report.status).toBe('degraded');
    expect(report.components.providers.status).toBe('degraded');
    expect(report.components.pipeline.status).toBe('healthy');
  });

  it('reports unhealthy when all providers are down', () => {
    const report = buildHealthReport(stateWith([false, false]), true);
    expect(report.status).toBe('unhealthy');
    expect(report.components.providers.status).toBe('unhealthy');
    expect(report.components.pipeline.status).toBe('unhealthy');
  });

  it('reports degraded when providers are healthy but redis is unavailable', () => {
    const report = buildHealthReport(stateWith([true, true]), false);
    expect(report.status).toBe('degraded');
    expect(report.components.redis.status).toBe('degraded');
    expect(report.components.pipeline.status).toBe('healthy');
  });

  it('reports unhealthy when no providers are registered', () => {
    const report = buildHealthReport(stateWith([]), true);
    expect(report.status).toBe('unhealthy');
    expect(report.components.providers.status).toBe('unhealthy');
    expect(report.components.pipeline.status).toBe('unhealthy');
  });
});

describe('registerHealthRoutes', () => {
  it('registers a GET handler that returns the health report', async () => {
    let handler: (...args: any[]) => any = () => undefined;
    const router = {
      get: jest.fn((_o, h) => {
        handler = h;
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as IRouter;

    const context = {
      router: { getCurrentRouteState: jest.fn(() => stateWith([true])) },
      cacheService: { isAvailable: jest.fn(() => true) },
      logger: { logRequest: jest.fn() },
    } as unknown as QueryCopilotContext;

    const response = { ok: jest.fn((x) => x) };

    registerHealthRoutes(router, context);
    await handler(
      {},
      { headers: {}, url: { pathname: '/api/query_copilot/health' } },
      response
    );

    expect(response.ok).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          status: 'healthy',
          components: expect.objectContaining({
            redis: expect.anything(),
            providers: expect.anything(),
            pipeline: expect.anything(),
          }),
        }),
      })
    );
    expect(context.cacheService.isAvailable).toHaveBeenCalled();
    expect(context.logger.logRequest).toHaveBeenCalled();
  });
});
