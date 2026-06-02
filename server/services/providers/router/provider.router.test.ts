import { ProviderRouter } from './provider.router';
import { PriorityRoutingStrategy } from './routing.strategy';
import type { HealthMonitor } from './health.monitor';
import type { ProviderHealthState } from './routing.strategy';
import type {
  ILLMProvider,
  ProviderMetadata,
  ProviderPrompt,
  ProviderResponse,
} from '../types';
import { ProviderError, ProviderRateLimitError } from '../errors';
import type { LoggerService } from '../../observability';
import { PROVIDER_NAMES } from '../../../../common/constants';
import type { ProviderName } from '../../../../common';

// ---------------------------------------------------------------------------
// ProviderRouter unit tests.
//
// API (verified against provider.router.ts):
//   route(prompt, requestId, preferredProvider?): Promise<ProviderResponse>
//
// Control flow:
//   - Builds a fallback chain from the routing strategy + health states.
//   - Calls provider.complete(prompt) on each in turn.
//   - Falls back on ProviderRateLimitError / ProviderUnavailableError /
//     ProviderTimeoutError (retryable). Aborts on other ProviderError.
//   - When the whole chain is exhausted, throws a ProviderUnavailableError
//     whose message begins "All providers exhausted after N attempt(s)".
//
// Collaborators are mocked with jest.fn():
//   - ILLMProvider instances: complete()/isHealthy()/getMetadata()/estimateTokens()
//   - HealthMonitor: only getHealthStates() + checkProvider() are read by router
//   - LoggerService: no-op jest.fn()s (router calls logPipelineStage,
//     logProviderCall, logError)
//   - PriorityRoutingStrategy: the real (pure) implementation is used.
// ---------------------------------------------------------------------------

const PROMPT: ProviderPrompt = {
  systemPrompt: 'sys',
  userMessage: 'find failed logins',
  temperature: 0.1,
};

function makeResponse(provider: ProviderName): ProviderResponse {
  return {
    content: '{"kql":"event.outcome : \\"failure\\""}',
    tokensUsed: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimatedAt: '2024-01-01T00:00:00Z',
      isActual: true,
    },
    rawResponse: {},
    latencyMs: 7,
    provider,
  };
}

function makeProvider(
  name: ProviderName,
  role: ProviderMetadata['role'],
  priority: number,
  complete: jest.Mock
): ILLMProvider {
  return {
    complete,
    isHealthy: jest.fn().mockResolvedValue(true),
    getMetadata: jest.fn<ProviderMetadata, []>().mockReturnValue({
      name,
      role,
      priority,
      maxTokens: 8192,
    }),
    estimateTokens: jest.fn().mockReturnValue(10),
  };
}

function makeLogger(): LoggerService {
  return {
    logRequest: jest.fn(),
    logPipelineStage: jest.fn(),
    logProviderCall: jest.fn(),
    logError: jest.fn(),
    logCacheEvent: jest.fn(),
  } as unknown as LoggerService;
}

function makeHealthMonitor(
  states: Map<ProviderName, ProviderHealthState>
): HealthMonitor {
  return {
    getHealthStates: jest.fn().mockReturnValue(states),
    checkProvider: jest.fn().mockResolvedValue(undefined),
  } as unknown as HealthMonitor;
}

function healthState(
  name: ProviderName,
  healthy: boolean
): ProviderHealthState {
  return {
    name,
    healthy,
    lastCheckedAt: '2024-01-01T00:00:00Z',
    consecutiveFailures: healthy ? 0 : 3,
  };
}

const PRIMARY = PROVIDER_NAMES.OPENAI as ProviderName; // role primary, priority 0
const FALLBACK = PROVIDER_NAMES.ANTHROPIC as ProviderName; // role fallback, priority 0

describe('ProviderRouter', () => {
  it('routes to the healthy primary and does not touch the fallback', async () => {
    const primaryComplete = jest.fn().mockResolvedValue(makeResponse(PRIMARY));
    const fallbackComplete = jest.fn().mockResolvedValue(makeResponse(FALLBACK));

    const providers = new Map<ProviderName, ILLMProvider>([
      [PRIMARY, makeProvider(PRIMARY, 'primary', 0, primaryComplete)],
      [FALLBACK, makeProvider(FALLBACK, 'fallback', 0, fallbackComplete)],
    ]);
    const health = makeHealthMonitor(
      new Map([
        [PRIMARY, healthState(PRIMARY, true)],
        [FALLBACK, healthState(FALLBACK, true)],
      ])
    );

    const router = new ProviderRouter(
      providers,
      health,
      new PriorityRoutingStrategy(),
      makeLogger()
    );

    const res = await router.route(PROMPT, 'req-1');

    expect(res.provider).toBe(PRIMARY);
    expect(primaryComplete).toHaveBeenCalledTimes(1);
    expect(fallbackComplete).not.toHaveBeenCalled();
  });

  it('falls back to the next provider on a rate-limit error', async () => {
    const primaryComplete = jest
      .fn()
      .mockRejectedValue(new ProviderRateLimitError(PRIMARY, { retryAfterMs: 1000 }));
    const fallbackComplete = jest.fn().mockResolvedValue(makeResponse(FALLBACK));

    const providers = new Map<ProviderName, ILLMProvider>([
      [PRIMARY, makeProvider(PRIMARY, 'primary', 0, primaryComplete)],
      [FALLBACK, makeProvider(FALLBACK, 'fallback', 0, fallbackComplete)],
    ]);
    const health = makeHealthMonitor(
      new Map([
        [PRIMARY, healthState(PRIMARY, true)],
        [FALLBACK, healthState(FALLBACK, true)],
      ])
    );

    const router = new ProviderRouter(
      providers,
      health,
      new PriorityRoutingStrategy(),
      makeLogger()
    );

    const res = await router.route(PROMPT, 'req-2');

    expect(primaryComplete).toHaveBeenCalledTimes(1);
    expect(fallbackComplete).toHaveBeenCalledTimes(1);
    expect(res.provider).toBe(FALLBACK);
    // background health re-check is triggered for the failed provider
    expect(health.checkProvider).toHaveBeenCalledWith(PRIMARY);
  });

  it('throws an all-providers-exhausted error when every provider fails', async () => {
    const primaryComplete = jest
      .fn()
      .mockRejectedValue(new ProviderRateLimitError(PRIMARY));
    const fallbackComplete = jest
      .fn()
      .mockRejectedValue(new ProviderRateLimitError(FALLBACK));

    const providers = new Map<ProviderName, ILLMProvider>([
      [PRIMARY, makeProvider(PRIMARY, 'primary', 0, primaryComplete)],
      [FALLBACK, makeProvider(FALLBACK, 'fallback', 0, fallbackComplete)],
    ]);
    const health = makeHealthMonitor(
      new Map([
        [PRIMARY, healthState(PRIMARY, true)],
        [FALLBACK, healthState(FALLBACK, true)],
      ])
    );

    const router = new ProviderRouter(
      providers,
      health,
      new PriorityRoutingStrategy(),
      makeLogger()
    );

    await expect(router.route(PROMPT, 'req-3')).rejects.toThrow(ProviderError);
    await expect(router.route(PROMPT, 'req-3')).rejects.toThrow(/All providers exhausted/i);
    expect(primaryComplete).toHaveBeenCalled();
    expect(fallbackComplete).toHaveBeenCalled();
  });

  it('throws when no providers are registered', async () => {
    const router = new ProviderRouter(
      new Map<ProviderName, ILLMProvider>(),
      makeHealthMonitor(new Map()),
      new PriorityRoutingStrategy(),
      makeLogger()
    );

    await expect(router.route(PROMPT, 'req-4')).rejects.toThrow(/No providers are registered/i);
  });
});
