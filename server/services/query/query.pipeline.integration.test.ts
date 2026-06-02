/**
 * Integration test for {@link QueryPipeline} (Task 10.2).
 *
 * Unlike the co-located unit test (`query.pipeline.test.ts`), which mocks every
 * collaborator, this test wires the pipeline with REAL service instances and
 * mocks ONLY the three boundary collaborators:
 *   - the LLM `ProviderRouter` (the `route` method is a programmable jest.fn),
 *   - the `ESMappingFetcher` (`fetchIndexMappings` returns a deterministic map),
 *   - Redis (an in-memory Map-backed fake `ioredis` client).
 *
 * The correction loop, cache, normalizer, intent extractor, ECS mapper, prompt
 * builder, KQL validator, token/cost estimators, and observability services are
 * all the genuine production classes.
 *
 * Note: per the repo convention (no `__tests__/` dirs anywhere — all tests are
 * co-located `*.test.ts`), this file is co-located rather than placed at the
 * task's literal `__tests__/` path.
 */
import Redis from 'ioredis';
import type { Logger } from '@kbn/core/server';

import { QueryPipeline } from './query.pipeline';
import type { QueryGenerationRequest } from './query.pipeline';

import { CacheService } from '../cache';
import type { ConfigService } from '../config';
import { QueryNormalizer, IntentExtractorService } from '../intent';
import { ECSContextMapper } from '../schema';
import type { ESMappingFetcher, ESIndexMapping, ESFieldMapping } from '../schema';
import { PromptBuilder } from '../prompt';
import type { ProviderRouter, ProviderResponse } from '../providers';
import { ProviderUnavailableError } from '../providers';
import { KQLValidatorService } from '../validation';
import { CorrectionEngine, CorrectionPromptBuilder } from '../correction';
import { TokenEstimatorService } from '../token';
import { CostEstimatorService } from '../cost';
import { LoggerService, MetricsService } from '../observability';

const MAX_RETRIES = 2;

// ── Fake boundary collaborators ───────────────────────────────────────────

/**
 * A minimal in-memory ioredis stand-in. Only the members CacheService touches
 * are implemented: `status` (must be `'ready'`), `get(key)`, and
 * `set(key, value, 'EX', ttl)`. Backed by a Map so writes from one execute()
 * are visible to the next, exercising the real cache hit/miss flow.
 */
function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    status: 'ready' as const,
    store,
    get: jest.fn(async (key: string): Promise<string | null> => store.get(key) ?? null),
    set: jest.fn(async (key: string, value: string): Promise<'OK'> => {
      store.set(key, value);
      return 'OK';
    }),
  };
}

/** Minimal ConfigService stub — CacheService only reads `getRedisConfig().ttl`. */
function makeConfig(): ConfigService {
  return {
    getRedisConfig: jest.fn().mockReturnValue({ host: 'localhost', port: 6379, ttl: 300 }),
  } as unknown as ConfigService;
}

/** A fake Kibana Logger whose methods are jest.fn(); `get()` returns itself. */
function makeFakeLogger(): Logger {
  const logger: Partial<Logger> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
  };
  logger.get = jest.fn(() => logger as Logger);
  return logger as Logger;
}

/**
 * Builds a deterministic ES index mapping. The valid-KQL fields
 * (`user.name`, `source.ip`, `event.outcome`) are present; the unknown field
 * used by the invalid KQL (`totally.bogus_field`) is deliberately absent — and
 * it is also not a recognized ECS field, so the validator flags it.
 */
function makeMapping(): ESIndexMapping {
  const fields = new Map<string, ESFieldMapping>();
  const add = (name: string, type: string): void => {
    fields.set(name, { name, type, searchable: true, aggregatable: true });
  };
  add('user.name', 'keyword');
  add('source.ip', 'ip');
  add('event.outcome', 'keyword');
  return { indexPattern: 'logs-*', fields, fetchedAt: new Date() };
}

// KQL fixtures. The valid KQL references only known fields; the invalid KQL
// references `totally.bogus_field`, which is neither in the mapping nor in the
// ECS catalogue, so it produces a deterministic field error.
const VALID_KQL = 'user.name : "admin" and event.outcome : "failure"';
const INVALID_KQL = 'totally.bogus_field : "x"';

/**
 * Builds a {@link ProviderResponse} whose JSON `content` matches the unit
 * test's exact shape: `{ kql, explanation, fieldsUsed, filtersApplied,
 * investigationReasoning }`.
 */
function providerResponse(kql: string, fields: string[]): ProviderResponse {
  return {
    content: JSON.stringify({
      kql,
      explanation: 'generated for the analyst request',
      fieldsUsed: fields,
      filtersApplied: fields.map((f) => `${f} filter`),
      investigationReasoning: 'derived from intent',
    }),
    tokensUsed: {
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      estimatedAt: '2024-01-01T00:00:00.000Z',
      isActual: true,
    },
    rawResponse: { ok: true },
    latencyMs: 25,
    provider: 'openai',
  };
}

// ── Harness ─────────────────────────────────────────────────────────────

interface Harness {
  pipeline: QueryPipeline;
  redis: ReturnType<typeof makeFakeRedis>;
  fetchIndexMappings: jest.Mock;
  route: jest.Mock;
}

/**
 * Constructs the pipeline with real services and the three mocked boundaries.
 * `routeMock` is the programmable ProviderRouter.route used by BOTH the
 * pipeline's initial generation and the (real) correction engine.
 */
function buildPipeline(routeMock: jest.Mock): Harness {
  const redis = makeFakeRedis();
  const logger = new LoggerService(makeFakeLogger());

  const cache = new CacheService(redis as unknown as Redis, makeConfig(), logger);
  const normalizer = new QueryNormalizer();
  const intentExtractor = new IntentExtractorService();
  const fetchIndexMappings = jest.fn().mockResolvedValue(makeMapping());
  const esMappingFetcher = {
    fetchIndexMappings,
  } as unknown as ESMappingFetcher;
  const ecsMapper = new ECSContextMapper();
  const promptBuilder = new PromptBuilder();
  const providerRouter = { route: routeMock } as unknown as ProviderRouter;
  const validator = new KQLValidatorService();
  const correctionEngine = new CorrectionEngine(
    new CorrectionPromptBuilder(),
    providerRouter,
    validator,
    logger,
    MAX_RETRIES
  );
  const tokenEstimator = new TokenEstimatorService();
  const costEstimator = new CostEstimatorService();
  const metrics = new MetricsService();

  const pipeline = new QueryPipeline(
    cache,
    normalizer,
    intentExtractor,
    esMappingFetcher,
    ecsMapper,
    promptBuilder,
    providerRouter,
    validator,
    correctionEngine,
    tokenEstimator,
    costEstimator,
    logger,
    metrics
  );

  return { pipeline, redis, fetchIndexMappings, route: routeMock };
}

function makeRequest(overrides: Partial<QueryGenerationRequest> = {}): QueryGenerationRequest {
  return {
    query: 'failed logins for admin from a single source ip',
    indexPattern: 'logs-*',
    sessionId: 'sess-integration-1',
    requestId: 'req-integration-1',
    ...overrides,
  };
}

// ── Scenarios ─────────────────────────────────────────────────────────────

describe('QueryPipeline integration (real services, mocked provider/redis/mapping)', () => {
  it('Test 1 — cache miss runs the full pipeline and stores a succeeded result', async () => {
    const route = jest.fn().mockResolvedValue(providerResponse(VALID_KQL, ['user.name', 'event.outcome']));
    const { pipeline, redis, fetchIndexMappings } = buildPipeline(route);

    const result = await pipeline.execute(makeRequest());

    expect(result.status).toBe('succeeded');
    expect(result.finalQuery?.queryString).toBe(VALID_KQL);
    expect(result.validationResult?.isValid).toBe(true);
    expect(result.errorCode).toBeNull();
    expect(route).toHaveBeenCalledTimes(1);
    expect(fetchIndexMappings).toHaveBeenCalledTimes(1);
    // The successful result was written to (fake) redis.
    expect(redis.set).toHaveBeenCalledTimes(1);
    expect(redis.store.size).toBe(1);
  });

  it('Test 2 — cache hit returns the cached result and skips generation', async () => {
    const route = jest.fn().mockResolvedValue(providerResponse(VALID_KQL, ['user.name', 'event.outcome']));
    const { pipeline, redis, fetchIndexMappings } = buildPipeline(route);
    const request = makeRequest();

    // First run populates the cache.
    const first = await pipeline.execute(request);
    expect(first.status).toBe('succeeded');
    const routeCallsAfterFirst = route.mock.calls.length;
    const fetchCallsAfterFirst = fetchIndexMappings.mock.calls.length;

    // Second identical run must hit the cache.
    const second = await pipeline.execute(request);

    expect(second.status).toBe('succeeded');
    expect(second.finalQuery?.queryString).toBe(VALID_KQL);
    // Cached body is returned verbatim except for refreshed run identity/timing.
    expect(second.pipelineId).not.toBe(first.pipelineId);
    expect(second.drafts).toEqual(first.drafts);
    // Generation + schema fetch were skipped on the cache hit.
    expect(route.mock.calls.length).toBe(routeCallsAfterFirst);
    expect(fetchIndexMappings.mock.calls.length).toBe(fetchCallsAfterFirst);
    expect(redis.get).toHaveBeenCalledTimes(2);
  });

  it('Test 3 — invalid KQL is corrected and succeeds on the second attempt', async () => {
    const route = jest
      .fn()
      .mockResolvedValueOnce(providerResponse(INVALID_KQL, ['totally.bogus_field']))
      .mockResolvedValueOnce(providerResponse(VALID_KQL, ['user.name', 'event.outcome']));
    const { pipeline } = buildPipeline(route);

    const result = await pipeline.execute(makeRequest());

    expect(result.status).toBe('corrected');
    expect(result.finalQuery?.queryString).toBe(VALID_KQL);
    expect(result.validationResult?.isValid).toBe(true);
    expect(result.correctionAttempts.length).toBeGreaterThanOrEqual(1);
    expect(result.correctionAttempts[result.correctionAttempts.length - 1]?.correctedQuery).toBe(
      VALID_KQL
    );
    // Initial generation (1) + one correction (1).
    expect(route).toHaveBeenCalledTimes(2);
    expect(result.errorCode).toBeNull();
  });

  it('Test 4 — all providers failing yields a failed result without throwing', async () => {
    const route = jest
      .fn()
      .mockRejectedValue(new ProviderUnavailableError('openai', 'all providers exhausted'));
    const { pipeline, redis } = buildPipeline(route);

    await expect(pipeline.execute(makeRequest())).resolves.toBeDefined();

    const result = await pipeline.execute(makeRequest());
    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('PROVIDER_UNREACHABLE');
    expect(result.errorMessage).toContain('unavailable');
    expect(result.finalQuery).toBeNull();
    // A failed result is never cached.
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.store.size).toBe(0);
  });

  it('Test 5 — validation never passes: corrections exhaust and a failed draft is returned', async () => {
    const route = jest
      .fn()
      .mockResolvedValue(providerResponse(INVALID_KQL, ['totally.bogus_field']));
    const { pipeline, redis } = buildPipeline(route);

    const result = await pipeline.execute(makeRequest());

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('PIPELINE_MAX_CORRECTIONS_EXCEEDED');
    // The last draft (the still-invalid corrected query) is surfaced.
    expect(result.finalQuery?.queryString).toBe(INVALID_KQL);
    expect(result.validationResult?.isValid).toBe(false);
    expect(result.validationResult?.errors.length).toBeGreaterThan(0);
    // Initial generation (1) + maxRetries corrections.
    expect(route).toHaveBeenCalledTimes(1 + MAX_RETRIES);
    // Failed results are not cached.
    expect(redis.set).not.toHaveBeenCalled();
  });
});
