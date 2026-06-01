import { QueryPipeline } from './query.pipeline';
import type { QueryGenerationRequest } from './query.pipeline';
import type { CacheService } from '../cache';
import type { QueryNormalizer, IntentExtractorService, NormalizedQuery } from '../intent';
import type { ESMappingFetcher, ECSContextMapper } from '../schema';
import type { PromptBuilder } from '../prompt';
import type { ProviderRouter, ProviderResponse } from '../providers';
import type { KQLValidatorService, ValidationResult } from '../validation';
import type { CorrectionEngine } from '../correction';
import type { TokenEstimatorService } from '../token';
import type { CostEstimatorService } from '../cost';
import type { LoggerService, MetricsService } from '../observability';
import type { InvestigationIntent, QueryPipelineResult, CostEstimate } from '../../../common/types';
import type { SchemaContext } from '../schema';

// ── Fixtures ────────────────────────────────────────────────────────────
const normalized: NormalizedQuery = {
  originalText: 'failed logins for admin',
  normalizedText: 'failed logins for admin',
  cacheKey: 'cache-key-abc',
};

const intent: InvestigationIntent = {
  type: 'brute_force',
  confidence: 0.9,
  reasoning: 'looks like brute force',
  suggestedFields: [],
  suggestedQueryLanguage: 'kql',
  timeRangeHint: null,
  entitiesExtracted: {
    ipAddresses: [],
    hostnames: [],
    usernames: [],
    processNames: [],
    filePaths: [],
    hashes: [],
    domains: [],
    ports: [],
  },
};

const schemaContext: SchemaContext = {
  relevantECSFields: [],
  availableIndexFields: ['user.name', 'source.ip'],
  fieldOverlap: ['user.name'],
};

const providerResponse: ProviderResponse = {
  content: JSON.stringify({
    kql: 'user.name : "admin"',
    explanation: 'failed logins for admin',
    fieldsUsed: ['user.name'],
    filtersApplied: ['user.name = admin'],
    investigationReasoning: 'brute force',
  }),
  tokensUsed: {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    estimatedAt: '2024-01-01T00:00:00.000Z',
    isActual: true,
  },
  rawResponse: { ok: true },
  latencyMs: 20,
  provider: 'openai',
};

const validResult: ValidationResult = {
  valid: true,
  syntaxErrors: [],
  fieldErrors: [],
  warnings: [],
  ecsFieldsUsed: [],
  totalFieldsInQuery: 1,
  ecsFieldCoverage: '1/1',
};

const invalidResult: ValidationResult = {
  valid: false,
  syntaxErrors: [],
  fieldErrors: [{ field: 'foo.bar', message: 'Unknown field "foo.bar"' }],
  warnings: [],
  ecsFieldsUsed: [],
  totalFieldsInQuery: 1,
  ecsFieldCoverage: '0/1',
};

const costEstimate: CostEstimate = {
  provider: 'openai',
  model: 'gpt-test',
  promptCostUsd: 0.001,
  completionCostUsd: 0.0005,
  totalCostUsd: 0.0015,
  currency: 'USD',
  rateCardVersion: '2024-01-01',
  estimatedAt: '2024-01-01T00:00:00.000Z',
  isActual: false,
};

const request: QueryGenerationRequest = {
  query: 'failed logins for admin',
  indexPattern: 'logs-*',
  sessionId: 'sess-1',
};

function makeMocks() {
  return {
    cache: { get: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined) },
    normalizer: { normalize: jest.fn().mockReturnValue(normalized) },
    intentExtractor: { extract: jest.fn().mockReturnValue(intent) },
    esMappingFetcher: {
      fetchIndexMappings: jest
        .fn()
        .mockResolvedValue({ indexPattern: 'logs-*', fields: new Map(), fetchedAt: new Date() }),
    },
    ecsMapper: { buildContext: jest.fn().mockReturnValue(schemaContext) },
    promptBuilder: {
      buildGenerationPrompt: jest.fn().mockReturnValue({ systemPrompt: 'sys', userMessage: 'user' }),
    },
    providerRouter: { route: jest.fn().mockResolvedValue(providerResponse) },
    validator: { validate: jest.fn().mockReturnValue(validResult) },
    correctionEngine: { correct: jest.fn() },
    tokenEstimator: {
      estimatePromptTokens: jest
        .fn()
        .mockReturnValue({ inputTokens: 10, outputTokens: 0, totalTokens: 10, provider: 'openai', estimationMethod: 'heuristic' }),
      estimateResponseTokens: jest
        .fn()
        .mockReturnValue({ inputTokens: 0, outputTokens: 5, totalTokens: 5, provider: 'openai', estimationMethod: 'heuristic' }),
    },
    costEstimator: { estimate: jest.fn().mockReturnValue(costEstimate) },
    logger: {
      logRequest: jest.fn(),
      logPipelineStage: jest.fn(),
      logProviderCall: jest.fn(),
      logError: jest.fn(),
      logCacheEvent: jest.fn(),
    },
    metrics: { recordEvent: jest.fn() },
  };
}

type Mocks = ReturnType<typeof makeMocks>;

function makePipeline(m: Mocks): QueryPipeline {
  return new QueryPipeline(
    m.cache as unknown as CacheService,
    m.normalizer as unknown as QueryNormalizer,
    m.intentExtractor as unknown as IntentExtractorService,
    m.esMappingFetcher as unknown as ESMappingFetcher,
    m.ecsMapper as unknown as ECSContextMapper,
    m.promptBuilder as unknown as PromptBuilder,
    m.providerRouter as unknown as ProviderRouter,
    m.validator as unknown as KQLValidatorService,
    m.correctionEngine as unknown as CorrectionEngine,
    m.tokenEstimator as unknown as TokenEstimatorService,
    m.costEstimator as unknown as CostEstimatorService,
    m.logger as unknown as LoggerService,
    m.metrics as unknown as MetricsService
  );
}

function makeCachedResult(): QueryPipelineResult {
  return {
    pipelineId: 'old-pipeline-id',
    status: 'succeeded',
    analystQuery: {
      id: 'aq-old',
      rawInput: 'failed logins for admin',
      normalizedInput: 'failed logins for admin',
      timestamp: '2024-01-01T00:00:00.000Z',
      intent: null,
      sessionId: 'sess-1',
      indexPattern: 'logs-*',
      requestedLanguage: null,
    },
    intent,
    drafts: [],
    finalQuery: null,
    validationResult: null,
    correctionAttempts: [],
    providerResponses: [],
    tokenEstimate: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedAt: '2024-01-01T00:00:00.000Z',
      isActual: false,
    },
    costEstimate,
    events: [],
    startedAt: '2024-01-01T00:00:00.000Z',
    completedAt: '2024-01-01T00:00:01.000Z',
    totalDurationMs: 5,
    errorCode: null,
    errorMessage: null,
  };
}

describe('QueryPipeline', () => {
  it('runs the happy path and returns a succeeded result', async () => {
    const m = makeMocks();
    const result = await makePipeline(m).execute(request);

    expect(result.status).toBe('succeeded');
    expect(result.finalQuery?.queryString).toBe('user.name : "admin"');
    expect(result.validationResult?.isValid).toBe(true);
    expect(result.drafts).toHaveLength(1);
    expect(result.providerResponses).toHaveLength(1);
    expect(result.providerResponses[0]?.provider).toBe('openai');
    expect(result.intent?.type).toBe('brute_force');
    expect(result.errorCode).toBeNull();
    expect(typeof result.totalDurationMs).toBe('number');
    expect(result.tokenEstimate.totalTokens).toBe(15);
    expect(m.cache.set).toHaveBeenCalledTimes(1);
    expect(m.correctionEngine.correct).not.toHaveBeenCalled();
  });

  it('returns the cached result on a cache hit without running downstream stages', async () => {
    const m = makeMocks();
    m.cache.get.mockResolvedValue(makeCachedResult());
    const result = await makePipeline(m).execute(request);

    expect(result.status).toBe('succeeded');
    expect(typeof result.pipelineId).toBe('string');
    expect(result.pipelineId).not.toBe('old-pipeline-id'); // refreshed identity
    expect(m.intentExtractor.extract).not.toHaveBeenCalled();
    expect(m.providerRouter.route).not.toHaveBeenCalled();
    expect(m.cache.set).not.toHaveBeenCalled();
    expect(m.logger.logCacheEvent).toHaveBeenCalledWith(expect.any(String), true, expect.any(String));
  });

  it('corrects an invalid query and reports corrected status', async () => {
    const m = makeMocks();
    m.validator.validate.mockReturnValue(invalidResult);
    m.correctionEngine.correct.mockResolvedValue({
      kql: 'user.name : "fixed"',
      validationResult: validResult,
      attempts: [
        {
          attemptNumber: 1,
          correctionPrompt: 'correction prompt',
          generatedKQL: 'user.name : "fixed"',
          validationResult: validResult,
          latencyMs: 11,
          providerUsed: 'openai',
        },
      ],
      succeeded: true,
    });

    const result = await makePipeline(m).execute(request);

    expect(m.correctionEngine.correct).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('corrected');
    expect(result.finalQuery?.queryString).toBe('user.name : "fixed"');
    expect(result.correctionAttempts).toHaveLength(1);
    expect(result.correctionAttempts[0]?.correctedQuery).toBe('user.name : "fixed"');
    expect(result.validationResult?.isValid).toBe(true);
    expect(result.drafts).toHaveLength(2); // initial + one correction
  });

  it('never throws on an unhandled error and returns a failed result', async () => {
    const m = makeMocks();
    m.normalizer.normalize.mockImplementation(() => {
      throw new Error('normalize boom');
    });

    const result = await makePipeline(m).execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('INTERNAL_ERROR');
    expect(result.errorMessage).toContain('normalize boom');
    expect(result.analystQuery.rawInput).toBe('failed logins for admin');
    expect(result.tokenEstimate.totalTokens).toBe(0);
    expect(m.logger.logError).toHaveBeenCalled();
  });

  it('returns a failed result with PROVIDER_UNREACHABLE when routing fails', async () => {
    const m = makeMocks();
    m.providerRouter.route.mockRejectedValue(new Error('all providers down'));

    const result = await makePipeline(m).execute(request);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('PROVIDER_UNREACHABLE');
    expect(m.logger.logError).toHaveBeenCalled();
  });

  it('produces a result containing every required QueryPipelineResult field', async () => {
    const m = makeMocks();
    const result = await makePipeline(m).execute(request);
    const requiredKeys: Array<keyof QueryPipelineResult> = [
      'pipelineId',
      'status',
      'analystQuery',
      'intent',
      'drafts',
      'finalQuery',
      'validationResult',
      'correctionAttempts',
      'providerResponses',
      'tokenEstimate',
      'costEstimate',
      'events',
      'startedAt',
      'completedAt',
      'totalDurationMs',
      'errorCode',
      'errorMessage',
    ];
    for (const key of requiredKeys) {
      expect(result).toHaveProperty(key);
    }
    expect(result.costEstimate.totalCostUsd).toBe(0.0015);
  });
});
