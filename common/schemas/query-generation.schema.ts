import { z } from 'zod';
import { ProviderNameSchema } from './primitives.schema';
import { ConversationMessageSchema } from './pipeline.schema';
import { QueryPipelineResultSchema } from './pipeline.schema';
import { PIPELINE_CONFIG } from '../constants';
import type { QueryPipelineResult } from '../types';

// ---------------------------------------------------------------------------
// QueryGenerationRequest
// The inbound API contract: what the client sends to start the pipeline.
// ---------------------------------------------------------------------------
export const QueryGenerationRequestSchema = z.object({
  /**
   * Natural-language query from the analyst.
   * Min 3: prevents accidental empty/whitespace submissions.
   * Max 500: matches AnalystQuery.rawInput constraint.
   */
  analystQuery: z
    .string()
    .min(3, 'Query must be at least 3 characters')
    .max(500, 'Query must not exceed 500 characters')
    .transform((val) => val.trim()),

  /**
   * Elasticsearch index pattern to target.
   * Examples: "logs-*", "filebeat-*", ".siem-signals-*"
   */
  indexPattern: z
    .string()
    .min(1, 'Index pattern is required')
    .max(256, 'Index pattern must not exceed 256 characters')
    .regex(
      /^[a-zA-Z0-9_\-.*]+$/,
      'Index pattern contains invalid characters'
    ),

  /**
   * Optional prior conversation turns for context-aware generation.
   * Capped at MAX_CONVERSATION_HISTORY to prevent context overflow.
   */
  conversationHistory: z
    .array(ConversationMessageSchema)
    .max(
      PIPELINE_CONFIG.MAX_CONVERSATION_HISTORY,
      `Conversation history must not exceed ${PIPELINE_CONFIG.MAX_CONVERSATION_HISTORY} messages`
    )
    .optional()
    .default([]),

  /**
   * Optionally pin a specific provider. Falls back to router if omitted.
   */
  preferredProvider: ProviderNameSchema.optional(),
});

export type QueryGenerationRequest = z.infer<typeof QueryGenerationRequestSchema>;

// ---------------------------------------------------------------------------
// QueryGenerationResponse
// The outbound API contract: exactly mirrors QueryPipelineResult.
// Using the pipeline schema ensures the response is always a validated result.
// ---------------------------------------------------------------------------
export const QueryGenerationResponseSchema: z.ZodType<QueryPipelineResult> =
  QueryPipelineResultSchema;

export type QueryGenerationResponse = z.infer<typeof QueryGenerationResponseSchema>;

// ---------------------------------------------------------------------------
// Error response envelope — used for all 4xx/5xx API responses
// ---------------------------------------------------------------------------
export const APIErrorResponseSchema = z.object({
  errorCode: z.string().min(1),
  message: z.string().min(1),
  details: z.array(z.string()).optional(),
  requestId: z.string().uuid().optional(),
  timestamp: z.string().datetime({ offset: true }),
  retryable: z.boolean(),
});

export type APIErrorResponse = z.infer<typeof APIErrorResponseSchema>;
