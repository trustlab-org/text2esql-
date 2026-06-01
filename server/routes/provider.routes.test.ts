/**
 * Unit tests for the Query Copilot provider status route.
 */

import { buildProviderStatuses, registerProviderRoutes } from './provider.routes';
import type { ProviderRoutingState } from '../services/providers';
import type { ConfigService } from '../services';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';

function makeState(): ProviderRoutingState {
  return {
    activeProvider: 'openai',
    providers: [
      {
        name: 'openai',
        healthy: true,
        lastCheckedAt: '2024-01-01T00:00:00.000Z',
        consecutiveFailures: 0,
        role: 'primary',
        priority: 1,
      },
      {
        name: 'gemini',
        healthy: false,
        lastCheckedAt: null,
        consecutiveFailures: 3,
        role: 'fallback',
        priority: 2,
      },
    ],
  } as unknown as ProviderRoutingState;
}

function makeConfig(): ConfigService {
  return {
    getProviderModel: jest.fn((n: string) => `${n}-model`),
    isProviderEnabled: jest.fn(() => true),
  } as unknown as ConfigService;
}

describe('buildProviderStatuses', () => {
  it('maps routing state and config into provider statuses', () => {
    const out = buildProviderStatuses(makeState(), makeConfig());

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      name: 'openai',
      role: 'primary',
      priority: 1,
      healthy: true,
      lastCheckedAt: '2024-01-01T00:00:00.000Z',
      model: 'openai-model',
      enabled: true,
    });
    expect(out[1].name).toBe('gemini');
    expect(out[1].healthy).toBe(false);
    expect(out[1].lastCheckedAt).toBe('');
    expect(out[1].model).toBe('gemini-model');
  });
});

describe('registerProviderRoutes', () => {
  it('registers a GET handler that returns the provider statuses', async () => {
    let handler: any;
    const router = {
      get: jest.fn((_o, h) => {
        handler = h;
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as IRouter;

    const context = {
      router: { getCurrentRouteState: jest.fn(() => makeState()) },
      config: makeConfig(),
      logger: { logRequest: jest.fn() },
    } as unknown as QueryCopilotContext;

    const response = { ok: jest.fn((x) => x) };

    registerProviderRoutes(router, context);
    await handler(
      {},
      { headers: {}, url: { pathname: '/api/query_copilot/providers' } },
      response
    );

    expect(response.ok).toHaveBeenCalledWith({
      body: {
        providers: expect.arrayContaining([expect.objectContaining({ name: 'openai' })]),
      },
    });
    expect(response.ok.mock.calls[0][0].body.providers).toHaveLength(2);
    expect(context.logger.logRequest).toHaveBeenCalled();
  });
});
