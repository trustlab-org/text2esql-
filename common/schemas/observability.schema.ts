import { z } from 'zod';
import {
  ObservabilityEventTypeSchema,
  ErrorSeveritySchema,
  ProviderNameSchema,
  ISODateTimeSchema,
} from './primitives.schema';
import type {
  ObservabilityEvent,
  QueryGeneratedPayload,
  QueryValidatedPayload,
  QueryCorrectedPayload,
  QueryFailedPayload,
  ProviderRequestPayload,
  ProviderResponsePayload,
  ProviderErrorPayload,
  CacheEventPayload,
  PipelineEventPayload,
  IntentClassifiedPayload,
} from '../types';

// ---------------------------------------------------------------------------
// Discriminated payload schemas
// z.discriminatedUnion requires z.ZodObject members — no ZodType annotation.
// We use `satisfies` to cross-check structural compatibility with the TS types.
// ---------------------------------------------------------------------------
export const QueryGeneratedPayloadSchema = z.object({
  kind: z.literal('query_generated'),
  language: z.string().min(1),
  queryLength: z.number().int().nonnegative(),
  attemptNumber: z.number().int().min(1),
  promptTokens: z.number().int().nonnegative(),
}) satisfies z.ZodType<QueryGeneratedPayload>;

export const QueryValidatedPayloadSchema = z.object({
  kind: z.literal('query_validated'),
  isValid: z.boolean(),
  errorCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  validationDurationMs: z.number().nonnegative(),
}) satisfies z.ZodType<QueryValidatedPayload>;

export const QueryCorrectedPayloadSchema = z.object({
  kind: z.literal('query_corrected'),
  attemptNumber: z.number().int().min(1),
  succeeded: z.boolean(),
  errorsAddressed: z.number().int().nonnegative(),
}) satisfies z.ZodType<QueryCorrectedPayload>;

export const QueryFailedPayloadSchema = z.object({
  kind: z.literal('query_failed'),
  errorCode: z.string().min(1),
  stage: z.string().min(1),
  maxAttemptsReached: z.boolean(),
}) satisfies z.ZodType<QueryFailedPayload>;

export const ProviderRequestPayloadSchema = z.object({
  kind: z.literal('provider_request'),
  provider: ProviderNameSchema,
  model: z.string().min(1),
  promptTokenEstimate: z.number().int().nonnegative(),
  stream: z.boolean(),
}) satisfies z.ZodType<ProviderRequestPayload>;

export const ProviderResponsePayloadSchema = z.object({
  kind: z.literal('provider_response'),
  provider: ProviderNameSchema,
  model: z.string().min(1),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  cached: z.boolean(),
  finishReason: z.string().min(1),
}) satisfies z.ZodType<ProviderResponsePayload>;

export const ProviderErrorPayloadSchema = z.object({
  kind: z.literal('provider_error'),
  provider: ProviderNameSchema,
  errorCode: z.string().min(1),
  statusCode: z.number().int().nullable(),
  retryable: z.boolean(),
}) satisfies z.ZodType<ProviderErrorPayload>;

export const CacheEventPayloadSchema = z.object({
  kind: z.enum(['cache_hit', 'cache_miss']),
  keyHash: z.string().min(1),
  ttlRemainingSeconds: z.number().nonnegative().optional(),
}) satisfies z.ZodType<CacheEventPayload>;

export const PipelineEventPayloadSchema = z.object({
  kind: z.enum(['pipeline_start', 'pipeline_complete', 'pipeline_abort']),
  totalDurationMs: z.number().nonnegative().optional(),
  stagesCompleted: z.array(z.string()).readonly().optional(),
  abortReason: z.string().optional(),
}) satisfies z.ZodType<PipelineEventPayload>;

export const IntentClassifiedPayloadSchema = z.object({
  kind: z.literal('intent_classified'),
  investigationType: z.string().min(1),
  confidence: z.number().min(0).max(1),
  suggestedLanguage: z.string().min(1),
}) satisfies z.ZodType<IntentClassifiedPayload>;

// ---------------------------------------------------------------------------
// Discriminated union over all payload variants — discriminant: `kind`
// ---------------------------------------------------------------------------
export const ObservabilityEventPayloadSchema = z.discriminatedUnion('kind', [
  QueryGeneratedPayloadSchema,
  QueryValidatedPayloadSchema,
  QueryCorrectedPayloadSchema,
  QueryFailedPayloadSchema,
  ProviderRequestPayloadSchema,
  ProviderResponsePayloadSchema,
  ProviderErrorPayloadSchema,
  CacheEventPayloadSchema,
  PipelineEventPayloadSchema,
  IntentClassifiedPayloadSchema,
]);

// ---------------------------------------------------------------------------
// ObservabilityEvent
// ZodType<ObservabilityEvent> annotation omitted because the payload union's
// inferred type is a supertype; satisfies verifies structural compatibility.
// ---------------------------------------------------------------------------
export const ObservabilityEventSchema = z.object({
  eventId: z.string().uuid(),
  type: ObservabilityEventTypeSchema,
  pipelineId: z.string().min(1),
  sessionId: z.string().min(1),
  timestamp: ISODateTimeSchema,
  durationMs: z.number().nonnegative().nullable(),
  severity: ErrorSeveritySchema,
  provider: ProviderNameSchema.nullable(),
  stage: z.string().nullable(),
  payload: ObservabilityEventPayloadSchema,
  tags: z.array(z.string()).readonly(),
}) satisfies z.ZodType<ObservabilityEvent>;

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ObservabilityEventSchemaType = z.infer<typeof ObservabilityEventSchema>;
export type ObservabilityEventPayloadSchemaType = z.infer<typeof ObservabilityEventPayloadSchema>;
