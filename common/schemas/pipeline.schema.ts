import { z } from 'zod';
import {
  ProviderNameSchema,
  ConversationRoleSchema,
  PipelineStatusSchema,
  ISODateTimeSchema,
} from './primitives.schema';
import { AnalystQuerySchema, InvestigationIntentSchema, QueryDraftSchema } from './intent.schema';
import { ValidationResultSchema, CorrectionAttemptSchema } from './validation.schema';
import { ProviderResponseSchema } from './provider.schema';
import { TokenEstimateSchema, CostEstimateSchema } from './cost.schema';
import { ObservabilityEventSchema } from './observability.schema';
import { PIPELINE_CONFIG } from '../constants';
import type {
  ConversationMessageMetadata,
  ConversationMessage,
  PipelineRequestMetadata,
  PipelineContext,
  QueryPipelineResult,
} from '../types';

// ---------------------------------------------------------------------------
// ConversationMessageMetadata
// ---------------------------------------------------------------------------
export const ConversationMessageMetadataSchema: z.ZodType<ConversationMessageMetadata> =
  z.object({
    tokensUsed: z.number().int().nonnegative().nullable(),
    provider: ProviderNameSchema.nullable(),
    model: z.string().nullable(),
    latencyMs: z.number().nonnegative().nullable(),
  });

// ---------------------------------------------------------------------------
// ConversationMessage
// ---------------------------------------------------------------------------
export const ConversationMessageSchema: z.ZodType<ConversationMessage> = z.object({
  id: z.string().uuid(),
  role: ConversationRoleSchema,
  content: z.string().min(1),
  timestamp: ISODateTimeSchema,
  pipelineId: z.string().nullable(),
  queryDraftId: z.string().nullable(),
  metadata: ConversationMessageMetadataSchema,
});

// ---------------------------------------------------------------------------
// PipelineRequestMetadata
// ---------------------------------------------------------------------------
export const PipelineRequestMetadataSchema: z.ZodType<PipelineRequestMetadata> = z.object({
  userAgent: z.string().nullable(),
  kibanaVersion: z.string().min(1),
  pluginVersion: z.string().min(1),
  requestId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// PipelineContext
// ---------------------------------------------------------------------------
export const PipelineContextSchema: z.ZodType<PipelineContext> = z.object({
  pipelineId: z.string().uuid(),
  sessionId: z.string().min(1),
  analystQuery: AnalystQuerySchema,
  selectedProvider: ProviderNameSchema,
  indexPattern: z.string().min(1),
  conversationHistory: z
    .array(ConversationMessageSchema)
    .max(PIPELINE_CONFIG.MAX_CONVERSATION_HISTORY)
    .readonly(),
  startedAt: ISODateTimeSchema,
  timeoutMs: z.number().int().positive().max(120_000),
  maxCorrectionAttempts: z
    .number()
    .int()
    .min(0)
    .max(PIPELINE_CONFIG.MAX_CORRECTION_ATTEMPTS),
  requestMetadata: PipelineRequestMetadataSchema,
});

// ---------------------------------------------------------------------------
// QueryPipelineResult — top-level response envelope
// ---------------------------------------------------------------------------
export const QueryPipelineResultSchema: z.ZodType<QueryPipelineResult> = z.object({
  pipelineId: z.string().uuid(),
  status: PipelineStatusSchema,
  analystQuery: AnalystQuerySchema,
  intent: InvestigationIntentSchema.nullable(),
  drafts: z.array(QueryDraftSchema).readonly(),
  finalQuery: QueryDraftSchema.nullable(),
  validationResult: ValidationResultSchema.nullable(),
  correctionAttempts: z.array(CorrectionAttemptSchema).readonly(),
  providerResponses: z.array(ProviderResponseSchema).readonly(),
  tokenEstimate: TokenEstimateSchema,
  costEstimate: CostEstimateSchema,
  events: z.array(ObservabilityEventSchema).readonly(),
  startedAt: ISODateTimeSchema,
  completedAt: ISODateTimeSchema.nullable(),
  totalDurationMs: z.number().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ConversationMessageMetadataSchemaType = z.infer<
  typeof ConversationMessageMetadataSchema
>;
export type ConversationMessageSchemaType = z.infer<typeof ConversationMessageSchema>;
export type PipelineRequestMetadataSchemaType = z.infer<typeof PipelineRequestMetadataSchema>;
export type PipelineContextSchemaType = z.infer<typeof PipelineContextSchema>;
export type QueryPipelineResultSchemaType = z.infer<typeof QueryPipelineResultSchema>;

// Re-export stage/status types for convenience
export type { PipelineStage, PipelineStatus } from '../types';
