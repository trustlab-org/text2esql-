import { schema } from '@kbn/config-schema';
import type { IRouter } from '@kbn/core/server';
import { PLUGIN_ROUTE_PREFIX, PROVIDER_NAMES, PIPELINE_CONFIG } from '../../common';

// ---------------------------------------------------------------------------
// Kibana config-schema definitions
//
// These mirror QueryGenerationRequestSchema (common/schemas/query-generation.schema.ts)
// at the transport boundary. Kibana's router ONLY accepts @kbn/config-schema objects
// for validation — Zod runs downstream in the service layer after deserialization.
//
// Keep these in sync with QueryGenerationRequestSchema manually. The TypeScript
// types from Zod serve as the source of truth; these are the enforcement layer.
// ---------------------------------------------------------------------------

/**
 * Mirrors ConversationMessage from common/types/pipeline.types.ts.
 * Only fields needed for context are validated here; the service layer
 * runs full Zod validation before processing.
 */
const conversationMessageSchema = schema.object({
  id: schema.string({ minLength: 1 }),
  role: schema.oneOf([
    schema.literal('user'),
    schema.literal('assistant'),
    schema.literal('system'),
  ]),
  content: schema.string({ minLength: 1 }),
  timestamp: schema.string({ minLength: 1 }), // ISO 8601 — full validation downstream
  pipelineId: schema.nullable(schema.string()),
  queryDraftId: schema.nullable(schema.string()),
  metadata: schema.object({
    tokensUsed: schema.nullable(schema.number()),
    provider: schema.nullable(
      schema.oneOf([
        schema.literal(PROVIDER_NAMES.GEMINI),
        schema.literal(PROVIDER_NAMES.GROQ),
        schema.literal(PROVIDER_NAMES.OLLAMA),
        schema.literal(PROVIDER_NAMES.ANTHROPIC),
        schema.literal(PROVIDER_NAMES.OPENAI),
      ])
    ),
    model: schema.nullable(schema.string()),
    latencyMs: schema.nullable(schema.number()),
  }),
});

/**
 * Mirrors QueryGenerationRequestSchema from common/schemas/query-generation.schema.ts.
 *
 * analystQuery:          3–500 chars, trimmed upstream
 * indexPattern:          1–256 chars, restricted character set
 * conversationHistory:   optional, capped at MAX_CONVERSATION_HISTORY
 * preferredProvider:     optional provider pin
 */
const queryGenerationRequestBodySchema = schema.object({
  analystQuery: schema.string({
    minLength: 3,
    maxLength: 500,
  }),
  indexPattern: schema.string({
    minLength: 1,
    maxLength: 256,
  }),
  conversationHistory: schema.arrayOf(conversationMessageSchema, {
    maxSize: PIPELINE_CONFIG.MAX_CONVERSATION_HISTORY,
    defaultValue: [],
  }),
  preferredProvider: schema.maybe(
    schema.oneOf([
      schema.literal(PROVIDER_NAMES.GEMINI),
      schema.literal(PROVIDER_NAMES.GROQ),
      schema.literal(PROVIDER_NAMES.OLLAMA),
      schema.literal(PROVIDER_NAMES.ANTHROPIC),
      schema.literal(PROVIDER_NAMES.OPENAI),
    ])
  ),
});

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Query generation routes.
 *
 * POST /api/query_copilot/generate
 *
 * Accepts a natural-language analyst query and returns a QueryPipelineResult.
 * Returns 501 until the pipeline orchestrator is implemented.
 *
 * Validation is intentionally two-layered:
 *   1. Kibana schema (here) — rejects malformed requests at the router boundary.
 *   2. Zod (service layer) — enforces full domain invariants before processing.
 */
export function registerQueryRoutes(router: IRouter): void {
  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/generate`,
      validate: {
        body: queryGenerationRequestBodySchema,
      },
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
        body: {
          accepts: ['application/json'],
          maxBytes: 1024 * 64, // 64 KiB — sufficient for query + conversation history
        },
      },
    },
    async (_context, _request, response) => {
      return response.customError({
        statusCode: 501,
        body: {
          message: 'Not yet implemented',
        },
      });
    }
  );
}
