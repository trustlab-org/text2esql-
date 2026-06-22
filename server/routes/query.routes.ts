import { schema, type TypeOf } from '@kbn/config-schema';
import { randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { QueryGenerationRequest } from '../services/query';
import {
  PLUGIN_ROUTE_PREFIX,
  PROVIDER_NAMES,
  QUERY_LANGUAGES,
  PIPELINE_CONFIG,
  ERROR_CODES,
} from '../../common';

const providerLiteral = schema.oneOf([
  schema.literal(PROVIDER_NAMES.GEMINI),
  schema.literal(PROVIDER_NAMES.GROQ),
  schema.literal(PROVIDER_NAMES.OLLAMA),
  schema.literal(PROVIDER_NAMES.ANTHROPIC),
  schema.literal(PROVIDER_NAMES.OPENAI),
]);

/**
 * A single provider credential supplied on the request. The apiKey is optional
 * (Ollama needs none) and bounded to a reasonable length; it is NEVER logged.
 */
const providerCredentialSchema = schema.object({
  provider: providerLiteral,
  apiKey: schema.maybe(schema.string({ maxLength: 512 })),
  model: schema.maybe(schema.string({ maxLength: 256 })),
  endpoint: schema.maybe(schema.string({ maxLength: 512 })),
});

/**
 * Optional per-request LLM credentials: a mandatory primary provider and an
 * optional (nullable) fallback. When present these build a request-scoped
 * router from the caller's own keys instead of the boot-time config.
 */
const requestCredentialsSchema = schema.object({
  primary: providerCredentialSchema,
  fallback: schema.maybe(schema.nullable(providerCredentialSchema)),
});

const conversationMessageSchema = schema.object({
  id: schema.string({ minLength: 1 }),
  role: schema.oneOf([
    schema.literal('user'),
    schema.literal('assistant'),
    schema.literal('system'),
  ]),
  content: schema.string({ minLength: 1 }),
  timestamp: schema.string({ minLength: 1 }),
  pipelineId: schema.nullable(schema.string()),
  queryDraftId: schema.nullable(schema.string()),
  metadata: schema.object({
    tokensUsed: schema.nullable(schema.number()),
    provider: schema.nullable(providerLiteral),
    model: schema.nullable(schema.string()),
    latencyMs: schema.nullable(schema.number()),
  }),
});

/**
 * Request body for POST /generate. Mirrors {@link QueryGenerationRequest}
 * minus `requestId`, which is generated server-side for correlation.
 */
const queryGenerationRequestBodySchema = schema.object({
  query: schema.string({ minLength: 3, maxLength: PIPELINE_CONFIG.MAX_QUERY_LENGTH_CHARS }),
  indexPattern: schema.string({ minLength: 1, maxLength: 256 }),
  sessionId: schema.string({ minLength: 1, maxLength: 256 }),
  requestedLanguage: schema.maybe(
    schema.nullable(
      schema.oneOf([
        schema.literal(QUERY_LANGUAGES.KQL),
        schema.literal(QUERY_LANGUAGES.EQL),
        schema.literal(QUERY_LANGUAGES.DSL),
        schema.literal(QUERY_LANGUAGES.ES_SQL),
      ])
    )
  ),
  conversationHistory: schema.arrayOf(conversationMessageSchema, {
    maxSize: PIPELINE_CONFIG.MAX_CONVERSATION_HISTORY,
    defaultValue: [],
  }),
  preferredProvider: schema.maybe(providerLiteral),
  credentials: schema.maybe(requestCredentialsSchema),
});

type QueryGenerationRequestBody = TypeOf<typeof queryGenerationRequestBodySchema>;

/**
 * Maps a {@link QueryPipelineResult} error code to an HTTP status:
 *   429 rate limit · 503 providers unavailable · 400 validation · 500 unexpected.
 */
export function errorCodeToHttpStatus(errorCode: string | null): number {
  switch (errorCode) {
    case ERROR_CODES.PROVIDER_RATE_LIMITED:
    case ERROR_CODES.RATE_LIMIT_EXCEEDED:
      return 429;
    case ERROR_CODES.PROVIDER_UNREACHABLE:
    case ERROR_CODES.PROVIDER_TIMEOUT:
    case ERROR_CODES.PROVIDER_NOT_CONFIGURED:
      return 503;
    case ERROR_CODES.PIPELINE_MAX_CORRECTIONS_EXCEEDED:
    case ERROR_CODES.PIPELINE_VALIDATION_FAILED:
    case ERROR_CODES.ES_SYNTAX_ERROR:
    case ERROR_CODES.VALIDATION_UNKNOWN_FIELD:
    case ERROR_CODES.VALIDATION_SCHEMA_MISMATCH:
    case ERROR_CODES.INTENT_EMPTY_INPUT:
      return 400;
    default:
      return 500;
  }
}

/**
 * Registers POST /api/query_copilot/generate.
 *
 * Validates the body against {@link QueryGenerationRequest}, builds a
 * per-request {@link QueryPipeline} (via the injected factory, bound to the
 * request-scoped ES client), runs it, and maps the result to an HTTP response.
 * The pipeline never throws; its `failed` results are mapped to 400/429/503,
 * and any unexpected error in the route itself maps to 500. Every response —
 * success or failure — carries the `X-Request-ID` correlation header.
 */
export function registerQueryRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/generate`,
      validate: { body: queryGenerationRequestBodySchema },
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
        body: { accepts: ['application/json'], maxBytes: 1024 * 64 },
      },
    },
    async (ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'POST', request.url.pathname);

      try {
        const coreCtx = await ctx.core;
        const esClient = coreCtx.elasticsearch.client.asCurrentUser;

        const body: QueryGenerationRequestBody = request.body;
        // body.credentials carries the caller's own API keys when present; it is
        // threaded into the pipeline factory (which builds a request-scoped
        // router) but is NEVER logged.
        const pipeline = context.createPipeline(esClient, body.credentials);

        const pipelineRequest: QueryGenerationRequest = {
          query: body.query,
          indexPattern: body.indexPattern,
          sessionId: body.sessionId,
          requestedLanguage: body.requestedLanguage ?? null,
          conversationHistory: body.conversationHistory,
          preferredProvider: body.preferredProvider,
          requestId,
        };

        const result = await pipeline.execute(pipelineRequest);

        context.logger.logPipelineStage(requestId, 'request_complete', result.totalDurationMs, {
          status: result.status,
          errorCode: result.errorCode,
        });

        if (result.status === 'failed') {
          return response.customError({
            statusCode: errorCodeToHttpStatus(result.errorCode),
            headers,
            body: {
              message: result.errorMessage ?? 'Query generation failed.',
              attributes: { requestId, errorCode: result.errorCode },
            },
          });
        }

        return response.ok({ headers, body: result });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'query_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error generating a query.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
