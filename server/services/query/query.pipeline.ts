/**
 * QueryPipeline — the end-to-end orchestrator.
 *
 * `execute` composes every pipeline stage into a single coordinated flow:
 *   normalize -> cache lookup -> intent classification -> schema context ->
 *   prompt build -> provider routing -> response parse -> validation ->
 *   correction (if needed) -> token/cost estimation -> cache write -> result.
 *
 * Every stage's timing is recorded on a {@link PipelineContext}. The method
 * NEVER throws to the HTTP layer: any unhandled error is caught and converted
 * into a `failed` {@link QueryPipelineResult}.
 *
 * Type-mapping note: the services in this plugin emit service-local types
 * (e.g. the validation service's `ValidationResult`, the correction engine's
 * `CorrectionAttempt`, and the providers' `ProviderResponse`). The public
 * result contract (`common/types`' {@link QueryPipelineResult}) is composed of
 * the *common* counterparts of those types, which have different shapes. This
 * orchestrator therefore maps the service outputs onto the common types (see
 * the private `map*` helpers). A handful of common fields that the services do
 * not surface (e.g. a response `model`, per-attempt `correctionReasoning`/
 * `tokensUsed`) are filled with sensible defaults.
 */
import { randomUUID } from 'node:crypto';

import {
  QUERY_LANGUAGES,
  ERROR_CODES,
  ERROR_SEVERITY,
  PROVIDER_NAMES,
  PROVIDER_DEFAULT_MODELS,
  OBSERVABILITY_EVENT_TYPES,
} from '../../../common/constants';
import type { ErrorCode } from '../../../common/constants';
import type {
  ProviderName,
  QueryLanguage,
  InvestigationIntent,
  AnalystQuery,
  QueryDraft,
  ConversationMessage,
  TokenEstimate,
  CostEstimate,
  QueryPipelineResult,
  PipelineStatus,
  ObservabilityEvent,
  ValidationResult as CommonValidationResult,
  ValidationError as CommonValidationError,
  CorrectionAttempt as CommonCorrectionAttempt,
  ProviderResponse as CommonProviderResponse,
} from '../../../common/types';

import { PipelineContext } from './pipeline.context';
import { SYSTEM_PROMPT_VERSION } from '../prompt';

import { CacheKeyBuilder, type CacheService } from '../cache';
import type { QueryNormalizer, IntentExtractorService, NormalizedQuery } from '../intent';
import type { ESMappingFetcher, ECSContextMapper, FieldValuesFetcher } from '../schema';
import type { IndexMappingProvider } from '../schema/es.mapping.fetcher';
import type { PromptBuilder } from '../prompt';
import type { ProviderRouter, ProviderResponse } from '../providers';
import type { KQLValidatorService, ValidationResult } from '../validation';
import type { CorrectionEngine, CorrectionAttempt } from '../correction';
import type { TokenEstimatorService } from '../token';
import type { CostEstimatorService } from '../cost';
import type { LoggerService, MetricsService } from '../observability';

/**
 * Input contract for {@link QueryPipeline.execute}.
 *
 * (Defined here in the query service: the task referenced
 * `common/types/query.types.ts`, which does not exist — the result type lives
 * in `common/types/pipeline.types.ts` and there is no request type, so the
 * request contract is owned by this service.)
 */
export interface QueryGenerationRequest {
  /** The raw analyst query text. */
  readonly query: string;
  /** Target Elasticsearch index pattern (e.g. "logs-*"). */
  readonly indexPattern: string;
  /** Session correlation id. */
  readonly sessionId: string;
  /** Optional preferred query language (the pipeline generates KQL). */
  readonly requestedLanguage?: QueryLanguage | null;
  /** Prior conversation turns, if any. */
  readonly conversationHistory?: readonly ConversationMessage[];
  /** Optional pinned provider. */
  readonly preferredProvider?: ProviderName;
  /** Optional request id; one is generated when absent. */
  readonly requestId?: string;
  /**
   * When true, the pipeline neither reads nor writes the result cache. Used by
   * the benchmark runner: the cache key is provider-agnostic (query + index), so
   * without this the FIRST provider's result would be served to every other
   * provider on the same case — making a cross-provider comparison meaningless.
   */
  readonly bypassCache?: boolean;
}

/**
 * Orchestrates the full query-generation pipeline. All collaborators are
 * injected; the pipeline is otherwise stateless across calls.
 */
export class QueryPipeline {
  private readonly cacheKeyBuilder = new CacheKeyBuilder();

  constructor(
    private readonly cache: CacheService,
    private readonly normalizer: QueryNormalizer,
    private readonly intentExtractor: IntentExtractorService,
    private readonly esMappingFetcher: ESMappingFetcher,
    /**
     * Samples real values for a curated set of high-signal fields so the prompt
     * can steer the model towards literals that actually exist in the index.
     * Best-effort and fast: it never throws and never blocks generation.
     */
    private readonly fieldValuesFetcher: FieldValuesFetcher,
    private readonly ecsMapper: ECSContextMapper,
    private readonly promptBuilder: PromptBuilder,
    private readonly providerRouter: ProviderRouter,
    private readonly validator: KQLValidatorService,
    private readonly correctionEngine: CorrectionEngine,
    private readonly tokenEstimator: TokenEstimatorService,
    private readonly costEstimator: CostEstimatorService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    /**
     * Optional MCP-backed index-mapping provider. When injected (i.e. the
     * `queryCopilot.mcp.enabled` flag is on), the schema-context stage sources
     * field mappings from this provider instead of {@link ESMappingFetcher}.
     * See the schema-context stage for the RBAC implications.
     */
    private readonly mcpMappingProvider?: IndexMappingProvider
  ) {}

  /**
   * Runs the full pipeline for a single request. Always RESOLVES — on any
   * unhandled error a `failed` {@link QueryPipelineResult} is returned.
   */
  public async execute(request: QueryGenerationRequest): Promise<QueryPipelineResult> {
    const requestId = request.requestId ?? randomUUID();
    const pipelineId = randomUUID();
    const analystQueryId = randomUUID();
    const ctx = new PipelineContext(requestId);
    const startedAtIso = new Date(ctx.startTime).toISOString();

    // The analyst query is required on every result, including early failures;
    // seed it from the raw request and refine it as stages complete.
    let intent: InvestigationIntent | null = null;
    let analystQuery: AnalystQuery = this.buildAnalystQuery(
      analystQueryId,
      request,
      request.query,
      startedAtIso,
      null
    );

    this.logger.logRequest(requestId, 'POST', '/api/query_copilot/generate');

    // Emits an observability event to MetricsService; best-effort, never throws.
    const emitMetric = (
      type: ObservabilityEvent['type'],
      payload: ObservabilityEvent['payload'],
      severity: ObservabilityEvent['severity'] = ERROR_SEVERITY.INFO
    ): void => {
      try {
        this.metrics.recordEvent({
          eventId: randomUUID(),
          type,
          pipelineId,
          sessionId: request.sessionId,
          timestamp: new Date().toISOString(),
          durationMs: ctx.getElapsedMs(),
          severity,
          provider: ctx.currentProvider,
          stage: null,
          payload,
          tags: [],
        });
      } catch {
        // Metrics must never break the pipeline.
      }
    };
    emitMetric(OBSERVABILITY_EVENT_TYPES.PIPELINE_START, { kind: 'pipeline_start' });

    try {
      // ── 1. Normalize ──────────────────────────────────────────────────
      const tNormalize = Date.now();
      const normalized: NormalizedQuery = this.normalizer.normalize(request.query);
      analystQuery = this.buildAnalystQuery(
        analystQueryId,
        request,
        normalized.normalizedText,
        startedAtIso,
        null
      );
      ctx.addStage({ stage: 'normalize', durationMs: Date.now() - tNormalize, success: true });

      // ── 2. Cache lookup ───────────────────────────────────────────────
      // Index-scoped, collision-resistant cache key (query hash + index pattern).
      const cacheKey = this.cacheKeyBuilder.buildKey(normalized.cacheKey, request.indexPattern);
      const tCacheGet = Date.now();
      // Benchmark runs bypass the cache so every provider actually calls its own
      // API (the key is provider-agnostic, so a cache hit would return whichever
      // provider ran first — see QueryGenerationRequest.bypassCache).
      const cached = request.bypassCache ? null : await this.cache.get(cacheKey);
      if (cached) {
        ctx.cacheHit = true;
        this.logger.logCacheEvent(requestId, true, cacheKey);
        emitMetric(OBSERVABILITY_EVENT_TYPES.CACHE_HIT, { kind: 'cache_hit', keyHash: cacheKey });
        ctx.addStage({
          stage: 'cache_lookup',
          durationMs: Date.now() - tCacheGet,
          success: true,
          metadata: { hit: true },
        });
        this.recordCompletion(ctx, request, pipelineId, cached.costEstimate.totalCostUsd);
        // Return the cached result with this run's identity and timing.
        return {
          ...cached,
          pipelineId,
          startedAt: startedAtIso,
          completedAt: new Date().toISOString(),
          totalDurationMs: ctx.getElapsedMs(),
        };
      }
      this.logger.logCacheEvent(requestId, false, cacheKey);
      emitMetric(OBSERVABILITY_EVENT_TYPES.CACHE_MISS, { kind: 'cache_miss', keyHash: cacheKey });
      ctx.addStage({
        stage: 'cache_lookup',
        durationMs: Date.now() - tCacheGet,
        success: true,
        metadata: { hit: false },
      });

      // ── 3. Intent classification ──────────────────────────────────────
      const tIntent = Date.now();
      intent = this.intentExtractor.extract(normalized);
      analystQuery = this.buildAnalystQuery(
        analystQueryId,
        request,
        normalized.normalizedText,
        startedAtIso,
        intent
      );
      ctx.addStage({
        stage: 'intent_classification',
        durationMs: Date.now() - tIntent,
        success: true,
        metadata: { type: intent.type, confidence: intent.confidence },
      });

      // ── 4. Schema context ─────────────────────────────────────────────
      const tSchema = Date.now();
      // MAPPING SOURCE (queryCopilot.mcp.enabled): when an MCP mapping provider is
      // injected, field mappings come from the MCP server's get_mappings tool.
      // RBAC DIVERGENCE: that path authenticates as the MCP container's ES identity
      // (Aryan), NOT the per-request asCurrentUser ESMappingFetcher path used when the
      // flag is off. Both return the identical ESIndexMapping, so downstream is agnostic.
      // If the MCP server is unreachable, the typed McpConnectionError/McpTimeoutError
      // propagates from here — we do NOT fall back to asCurrentUser, so an MCP outage
      // surfaces loudly rather than being silently masked.
      const esMapping = await (this.mcpMappingProvider ?? this.esMappingFetcher).fetchIndexMappings(
        request.indexPattern
      );
      // Sample real values for high-signal fields so the model uses literals that
      // actually exist (e.g. event.action:"login" instead of a guessed ECS value).
      // Best-effort and graceful: this never throws and never blocks generation,
      // and runs against the per-request esClient independently of the mapping source.
      const fieldValues = await this.fieldValuesFetcher.fetchValues(
        request.indexPattern,
        esMapping
      );
      const schemaContext = this.ecsMapper.buildContext(intent, esMapping, fieldValues);
      ctx.addStage({
        stage: 'schema_context',
        durationMs: Date.now() - tSchema,
        success: true,
        metadata: {
          availableFields: schemaContext.availableIndexFields.length,
          fieldOverlap: schemaContext.fieldOverlap.length,
          valueFields: fieldValues.size,
        },
      });

      // ── 5. Prompt build ───────────────────────────────────────────────
      const tPrompt = Date.now();
      const history: ConversationMessage[] = request.conversationHistory
        ? [...request.conversationHistory]
        : [];
      const prompt = this.promptBuilder.buildGenerationPrompt(
        intent,
        schemaContext,
        history,
        request.query,
        request.indexPattern
      );
      ctx.addStage({ stage: 'query_generation', durationMs: Date.now() - tPrompt, success: true });

      // ── 6. Provider routing ───────────────────────────────────────────
      const tRoute = Date.now();
      let response: ProviderResponse | undefined;
      try {
        response = await this.providerRouter.route(prompt, requestId, request.preferredProvider);
      } catch (routeError) {
        ctx.addStage({ stage: 'route', durationMs: Date.now() - tRoute, success: false });
        this.logger.logError(requestId, routeError, { stage: 'route' });
        emitMetric(
          OBSERVABILITY_EVENT_TYPES.PROVIDER_ERROR,
          {
            kind: 'provider_error',
            provider: request.preferredProvider ?? PROVIDER_NAMES.OPENAI,
            errorCode: ERROR_CODES.PROVIDER_UNREACHABLE,
            statusCode: null,
            retryable: true,
          },
          ERROR_SEVERITY.ERROR
        );
        return this.buildFailureResult({
          pipelineId,
          analystQuery,
          intent,
          startedAtIso,
          ctx,
          sessionId: request.sessionId,
          errorCode: ERROR_CODES.PROVIDER_UNREACHABLE,
          error: routeError,
        });
      }
      if (!response) {
        return this.buildFailureResult({
          pipelineId,
          analystQuery,
          intent,
          startedAtIso,
          ctx,
          sessionId: request.sessionId,
          errorCode: ERROR_CODES.PROVIDER_INVALID_RESPONSE,
          error: new Error('Provider returned no response.'),
        });
      }
      ctx.currentProvider = response.provider;
      ctx.addStage({
        stage: 'route',
        durationMs: Date.now() - tRoute,
        success: true,
        metadata: { provider: response.provider, latencyMs: response.latencyMs },
      });
      this.logger.logProviderCall(
        requestId,
        response.provider,
        response.latencyMs,
        response.tokensUsed.totalTokens,
        true
      );
      emitMetric(OBSERVABILITY_EVENT_TYPES.PROVIDER_RESPONSE, {
        kind: 'provider_response',
        provider: response.provider,
        model: '',
        promptTokens: response.tokensUsed.promptTokens,
        completionTokens: response.tokensUsed.completionTokens,
        latencyMs: response.latencyMs,
        cached: false,
        finishReason: 'stop',
      });

      // ── 7. Parse response JSON ────────────────────────────────────────
      const tParse = Date.now();
      const { query: generatedKQL, language: generatedLanguage } = this.extractKql(
        response.content
      );
      ctx.addStage({ stage: 'response_parse', durationMs: Date.now() - tParse, success: true });

      // ── 8. Validate ───────────────────────────────────────────────────
      // The validator branches on language: KQL runs the kuery syntax + field
      // check (unchanged); ES|QL runs a synchronous ES|QL syntax check.
      const tValidate = Date.now();
      let validation: ValidationResult = this.validator.validate(
        generatedKQL,
        schemaContext,
        generatedLanguage
      );
      const validationDurationMs = Date.now() - tValidate;
      ctx.addStage({
        stage: 'validation',
        durationMs: validationDurationMs,
        success: validation.valid,
        metadata: { valid: validation.valid, coverage: validation.ecsFieldCoverage },
      });

      // ── 9. Correct (if needed) ────────────────────────────────────────
      let serviceAttempts: readonly CorrectionAttempt[] = [];
      let correctionSucceeded = true;
      // The correction engine re-prompts and re-validates as KQL, so it only
      // runs for KQL. A malformed ES|QL query is reported as a syntax failure
      // directly (its real ES|QL parse error), not run through KQL correction.
      if (!validation.valid && generatedLanguage !== QUERY_LANGUAGES.ESQL) {
        const tCorrect = Date.now();
        const correction = await this.correctionEngine.correct({
          originalPrompt: prompt,
          generatedKQL,
          validationResult: validation,
          schemaContext,
          requestId,
        });
        validation = correction.validationResult;
        serviceAttempts = correction.attempts;
        correctionSucceeded = correction.succeeded;
        ctx.addStage({
          stage: 'correction',
          durationMs: Date.now() - tCorrect,
          success: correction.succeeded,
          metadata: { attempts: correction.attempts.length, succeeded: correction.succeeded },
        });
        emitMetric(OBSERVABILITY_EVENT_TYPES.QUERY_CORRECTED, {
          kind: 'query_corrected',
          attemptNumber: correction.attempts.length,
          succeeded: correction.succeeded,
          errorsAddressed: correction.attempts.length,
        });
      }

      emitMetric(OBSERVABILITY_EVENT_TYPES.QUERY_VALIDATED, {
        kind: 'query_validated',
        isValid: validation.valid,
        errorCount: validation.syntaxErrors.length + validation.fieldErrors.length,
        warningCount: validation.warnings.length,
        validationDurationMs,
      });

      // ── 10. Estimate tokens & cost ────────────────────────────────────
      // Prefer ACTUAL usage reported by the provider API (isActual: true) over
      // re-estimating with the tokenizer; fall back to a tiktoken estimate when
      // the adapter could not report real usage.
      const tEstimate = Date.now();
      let tokenEstimate: TokenEstimate;
      if (response.tokensUsed.isActual) {
        tokenEstimate = {
          promptTokens: response.tokensUsed.promptTokens,
          completionTokens: response.tokensUsed.completionTokens,
          totalTokens: response.tokensUsed.totalTokens,
          estimatedAt: new Date().toISOString(),
          isActual: true,
        };
      } else {
        const promptEstimate = this.tokenEstimator.estimatePromptTokens(prompt, response.provider);
        const responseEstimate = this.tokenEstimator.estimateResponseTokens(
          response.content,
          response.provider
        );
        tokenEstimate = {
          promptTokens: promptEstimate.totalTokens,
          completionTokens: responseEstimate.totalTokens,
          totalTokens: promptEstimate.totalTokens + responseEstimate.totalTokens,
          estimatedAt: new Date().toISOString(),
          isActual: false,
        };
      }
      const costEstimate = this.estimateCost(tokenEstimate, response.provider);
      ctx.addStage({ stage: 'estimation', durationMs: Date.now() - tEstimate, success: true });

      // ── 11. Assemble result ───────────────────────────────────────────
      const status: PipelineStatus = validation.valid
        ? serviceAttempts.length > 0
          ? 'corrected'
          : 'succeeded'
        : 'failed';

      const drafts = this.buildDrafts(
        analystQueryId,
        generatedKQL,
        serviceAttempts,
        response.provider,
        tokenEstimate.totalTokens,
        generatedLanguage
      );
      const finalQuery = drafts.length > 0 ? drafts[drafts.length - 1]! : null;

      const result: QueryPipelineResult = {
        pipelineId,
        status,
        analystQuery,
        intent,
        drafts,
        finalQuery,
        validationResult: this.mapValidationResult(
          validation,
          validationDurationMs,
          generatedLanguage
        ),
        correctionAttempts: this.mapCorrectionAttempts(serviceAttempts, generatedKQL),
        providerResponses: [this.mapProviderResponse(response, requestId)],
        tokenEstimate,
        costEstimate,
        events: [],
        startedAt: startedAtIso,
        completedAt: new Date().toISOString(),
        totalDurationMs: ctx.getElapsedMs(),
        errorCode: status === 'failed' ? ERROR_CODES.PIPELINE_MAX_CORRECTIONS_EXCEEDED : null,
        errorMessage:
          status === 'failed'
            ? 'The generated query did not pass validation after correction attempts.'
            : null,
      };

      // ── 12. Cache write (successful results only) ─────────────────────
      // Skipped for benchmark runs so one provider's result never pollutes the
      // provider-agnostic cache key for the others.
      if (status !== 'failed' && !request.bypassCache) {
        const tCacheSet = Date.now();
        await this.cache.set(cacheKey, result);
        ctx.addStage({ stage: 'cache_write', durationMs: Date.now() - tCacheSet, success: true });
      }

      // ── 13. Metrics + completion log ──────────────────────────────────
      this.recordCompletion(ctx, request, pipelineId, costEstimate.totalCostUsd);
      this.logger.logPipelineStage(requestId, 'pipeline_complete', ctx.getElapsedMs(), {
        status,
        stages: ctx.stages.length,
        cacheHit: ctx.cacheHit,
        correctionSucceeded,
      });

      return result;
    } catch (error) {
      // Unhandled failure anywhere in the flow — never throw to the HTTP layer.
      this.logger.logError(requestId, error, { stage: 'pipeline' });
      return this.buildFailureResult({
        pipelineId,
        analystQuery,
        intent,
        startedAtIso,
        ctx,
        sessionId: request.sessionId,
        errorCode: ERROR_CODES.INTERNAL_ERROR,
        error,
      });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Builds the {@link AnalystQuery} envelope for the result. */
  private buildAnalystQuery(
    id: string,
    request: QueryGenerationRequest,
    normalizedInput: string,
    timestamp: string,
    intent: InvestigationIntent | null
  ): AnalystQuery {
    return {
      id,
      rawInput: request.query,
      normalizedInput,
      timestamp,
      intent,
      sessionId: request.sessionId,
      indexPattern: request.indexPattern,
      requestedLanguage: request.requestedLanguage ?? null,
    };
  }

  /** Builds the ordered list of drafts: the initial generation plus each correction. */
  private buildDrafts(
    analystQueryId: string,
    initialKQL: string,
    attempts: readonly CorrectionAttempt[],
    provider: ProviderName,
    tokensUsed: number,
    language: QueryLanguage
  ): QueryDraft[] {
    const drafts: QueryDraft[] = [
      this.buildDraft(analystQueryId, initialKQL, 0, provider, tokensUsed, language),
    ];
    for (const attempt of attempts) {
      drafts.push(
        this.buildDraft(
          analystQueryId,
          attempt.generatedKQL,
          attempt.attemptNumber,
          attempt.providerUsed,
          0,
          language
        )
      );
    }
    return drafts;
  }

  /** Builds a single {@link QueryDraft}. */
  private buildDraft(
    analystQueryId: string,
    queryString: string,
    generationAttempt: number,
    provider: ProviderName,
    tokensUsed: number,
    language: QueryLanguage
  ): QueryDraft {
    return {
      id: randomUUID(),
      analystQueryId,
      language,
      queryString,
      generatedAt: new Date().toISOString(),
      generationAttempt,
      providerUsed: provider,
      tokensUsed,
      promptVersion: SYSTEM_PROMPT_VERSION,
    };
  }

  /** Maps the validation service's result onto the common `ValidationResult`. */
  private mapValidationResult(
    result: ValidationResult,
    durationMs: number,
    language: QueryLanguage
  ): CommonValidationResult {
    const warnings: CommonValidationError[] = result.warnings.map(
      (message): CommonValidationError => ({
        code: ERROR_CODES.VALIDATION_SCHEMA_MISMATCH,
        message,
        field: null,
        line: null,
        column: null,
        severity: ERROR_SEVERITY.WARNING,
        suggestion: null,
      })
    );

    return {
      isValid: result.valid,
      language,
      errors: this.mapValidationErrors(result),
      warnings,
      validatedAt: new Date().toISOString(),
      validationDurationMs: durationMs,
    };
  }

  /** Flattens the service validation's syntax + field errors into common `ValidationError`s. */
  private mapValidationErrors(result: ValidationResult): CommonValidationError[] {
    const syntax: CommonValidationError[] = result.syntaxErrors.map(
      (e): CommonValidationError => ({
        code: ERROR_CODES.ES_SYNTAX_ERROR,
        message: e.message,
        field: null,
        line: null,
        column: e.position,
        severity: ERROR_SEVERITY.ERROR,
        suggestion: e.token !== null ? `Unexpected token: ${e.token}` : null,
      })
    );
    const fields: CommonValidationError[] = result.fieldErrors.map(
      (e): CommonValidationError => ({
        code: ERROR_CODES.VALIDATION_UNKNOWN_FIELD,
        message: e.message,
        field: e.field,
        line: null,
        column: null,
        severity: ERROR_SEVERITY.ERROR,
        suggestion: null,
      })
    );
    return [...syntax, ...fields];
  }

  /** Maps the correction engine's attempts onto common `CorrectionAttempt`s. */
  private mapCorrectionAttempts(
    attempts: readonly CorrectionAttempt[],
    initialKQL: string
  ): CommonCorrectionAttempt[] {
    const mapped: CommonCorrectionAttempt[] = [];
    let previousQuery = initialKQL;
    for (const attempt of attempts) {
      mapped.push({
        attemptNumber: attempt.attemptNumber,
        originalQuery: previousQuery,
        correctedQuery: attempt.generatedKQL,
        errors: this.mapValidationErrors(attempt.validationResult),
        correctionReasoning: '',
        providerUsed: attempt.providerUsed,
        tokensUsed: 0,
        succeededValidation: attempt.validationResult.valid,
        attemptedAt: new Date().toISOString(),
        durationMs: attempt.latencyMs,
      });
      previousQuery = attempt.generatedKQL;
    }
    return mapped;
  }

  /** Maps a provider service response onto the common `ProviderResponse`. */
  private mapProviderResponse(
    response: ProviderResponse,
    requestId: string
  ): CommonProviderResponse {
    return {
      provider: response.provider,
      model: '',
      content: response.content,
      finishReason: 'stop',
      usage: {
        promptTokens: response.tokensUsed.promptTokens,
        completionTokens: response.tokensUsed.completionTokens,
        totalTokens: response.tokensUsed.totalTokens,
      },
      latencyMs: response.latencyMs,
      requestId,
      cached: false,
      raw: response.rawResponse,
    };
  }

  /** Estimates cost, defensively (cost estimation must not break the pipeline). */
  private estimateCost(tokenEstimate: TokenEstimate, provider: ProviderName): CostEstimate {
    try {
      // The routed response does not carry its model id, so price against the
      // provider's default-model rate card. An empty model would miss both the
      // exact and wildcard pricing keys and silently price everything at $0.
      return this.costEstimator.estimate(
        tokenEstimate,
        provider,
        PROVIDER_DEFAULT_MODELS[provider]
      );
    } catch {
      return this.zeroCostEstimate(provider);
    }
  }

  /** A zero-valued cost estimate, used as a safe fallback. */
  private zeroCostEstimate(provider: ProviderName): CostEstimate {
    return {
      provider,
      model: '',
      promptCostUsd: 0,
      completionCostUsd: 0,
      totalCostUsd: 0,
      currency: 'USD',
      rateCardVersion: 'unknown',
      estimatedAt: new Date().toISOString(),
      isActual: false,
    };
  }

  /** A zero-valued token estimate, used for failure results. */
  private zeroTokenEstimate(): TokenEstimate {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedAt: new Date().toISOString(),
      isActual: false,
    };
  }

  /**
   * Defensively extracts the `kql` string from an LLM response. The model is
   * asked for a JSON object with a `kql` field, but responses may be wrapped in
   * Markdown code fences or include surrounding prose; if no JSON object with a
   * string `kql` can be recovered, the stripped content is returned as-is.
   */
  private extractKql(content: string): { query: string; language: QueryLanguage } {
    const text = this.stripCodeFences((content ?? '').trim());
    const obj =
      this.tryParseObject(text) ?? this.tryParseObject(this.extractFirstJsonObject(text));
    const language = this.parseLanguage(obj);
    if (obj && typeof obj.kql === 'string') {
      return { query: obj.kql, language };
    }
    return { query: text, language };
  }

  /**
   * Reads an OPTIONAL `language` key from the parsed model JSON, validated
   * against {@link QUERY_LANGUAGES}. Defaults to KQL when absent or unrecognised.
   * The model does not emit this field yet (the prompt is unchanged), so today
   * this always resolves to KQL — purely carrying the language contract forward.
   */
  private parseLanguage(obj: Record<string, unknown> | null): QueryLanguage {
    const raw = obj?.language;
    const values = Object.values(QUERY_LANGUAGES) as string[];
    if (typeof raw === 'string' && values.includes(raw)) {
      return raw as QueryLanguage;
    }
    return QUERY_LANGUAGES.KQL;
  }

  /** Removes a leading json code fence and a trailing code fence, then trims. */
  private stripCodeFences(text: string): string {
    return text
      .replace(/^`{3}(?:json)?\s*/i, '')
      .replace(/\s*`{3}$/i, '')
      .trim();
  }

  /** Returns the substring from the first brace to the last brace (inclusive), else empty. */
  private extractFirstJsonObject(text: string): string {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) {
      return text.slice(first, last + 1);
    }
    return '';
  }

  /** Parses `text` as a plain JSON object, or returns null on any failure. */
  private tryParseObject(text: string): Record<string, unknown> | null {
    if (!text) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** Records a pipeline-completion metrics event (incl. run cost). Best-effort: never throws. */
  private recordCompletion(
    ctx: PipelineContext,
    request: QueryGenerationRequest,
    pipelineId: string,
    costUsd: number
  ): void {
    try {
      const event: ObservabilityEvent = {
        eventId: randomUUID(),
        type: OBSERVABILITY_EVENT_TYPES.PIPELINE_COMPLETE,
        pipelineId,
        sessionId: request.sessionId,
        timestamp: new Date().toISOString(),
        durationMs: ctx.getElapsedMs(),
        severity: ERROR_SEVERITY.INFO,
        provider: ctx.currentProvider,
        stage: null,
        payload: {
          kind: 'pipeline_complete',
          totalDurationMs: ctx.getElapsedMs(),
          stagesCompleted: ctx.stages.map((s) => s.stage),
          costUsd,
        },
        tags: [],
      };
      this.metrics.recordEvent(event);
    } catch {
      // Metrics must never break the pipeline.
    }
  }

  /** Builds a `failed` result that carries whatever context is available. */
  private buildFailureResult(args: {
    pipelineId: string;
    analystQuery: AnalystQuery;
    intent: InvestigationIntent | null;
    startedAtIso: string;
    ctx: PipelineContext;
    sessionId: string;
    errorCode: ErrorCode;
    error: unknown;
  }): QueryPipelineResult {
    const { pipelineId, analystQuery, intent, startedAtIso, ctx, errorCode, error } = args;
    const provider = ctx.currentProvider ?? PROVIDER_NAMES.OPENAI;

    try {
      const event: ObservabilityEvent = {
        eventId: randomUUID(),
        type: OBSERVABILITY_EVENT_TYPES.PIPELINE_ABORT,
        pipelineId,
        sessionId: args.sessionId,
        timestamp: new Date().toISOString(),
        durationMs: ctx.getElapsedMs(),
        severity: ERROR_SEVERITY.ERROR,
        provider: ctx.currentProvider,
        stage: null,
        payload: { kind: 'pipeline_abort', abortReason: errorCode },
        tags: [],
      };
      this.metrics.recordEvent(event);
    } catch {
      // ignore metrics failures
    }

    return {
      pipelineId,
      status: 'failed',
      analystQuery,
      intent,
      drafts: [],
      finalQuery: null,
      validationResult: null,
      correctionAttempts: [],
      providerResponses: [],
      tokenEstimate: this.zeroTokenEstimate(),
      costEstimate: this.zeroCostEstimate(provider),
      events: [],
      startedAt: startedAtIso,
      completedAt: new Date().toISOString(),
      totalDurationMs: ctx.getElapsedMs(),
      errorCode,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}