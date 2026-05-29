import { z } from 'zod';
import {
  InvestigationTypeSchema,
  QueryLanguageSchema,
  ISODateTimeSchema,
} from './primitives.schema';
import { ECSFieldSchema } from './ecs.schema';
import type {
  InvestigationIntent,
  TimeRangeHint,
  ExtractedEntities,
  AnalystQuery,
  QueryDraft,
} from '../types';

// ---------------------------------------------------------------------------
// TimeRangeHint
// ---------------------------------------------------------------------------
export const TimeRangeHintSchema: z.ZodType<TimeRangeHint> = z.object({
  relative: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

// ---------------------------------------------------------------------------
// ExtractedEntities
// ---------------------------------------------------------------------------
export const ExtractedEntitiesSchema: z.ZodType<ExtractedEntities> = z.object({
  ipAddresses: z.array(z.string().ip()).readonly(),
  hostnames: z.array(z.string().min(1)).readonly(),
  usernames: z.array(z.string().min(1)).readonly(),
  processNames: z.array(z.string().min(1)).readonly(),
  filePaths: z.array(z.string().min(1)).readonly(),
  hashes: z.array(z.string().min(1)).readonly(),
  domains: z
    .array(z.string().min(1))
    .readonly(),
  ports: z.array(z.number().int().min(0).max(65535)).readonly(),
});

// ---------------------------------------------------------------------------
// InvestigationIntent
// ---------------------------------------------------------------------------
export const InvestigationIntentSchema: z.ZodType<InvestigationIntent> = z.object({
  type: InvestigationTypeSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
  suggestedFields: z.array(ECSFieldSchema).readonly(),
  suggestedQueryLanguage: QueryLanguageSchema,
  timeRangeHint: TimeRangeHintSchema.nullable(),
  entitiesExtracted: ExtractedEntitiesSchema,
});

// ---------------------------------------------------------------------------
// AnalystQuery
// ---------------------------------------------------------------------------
export const AnalystQuerySchema: z.ZodType<AnalystQuery> = z.object({
  id: z.string().uuid(),
  rawInput: z.string().min(1).max(500),
  normalizedInput: z.string().min(1),
  timestamp: ISODateTimeSchema,
  intent: InvestigationIntentSchema.nullable(),
  sessionId: z.string().min(1),
  indexPattern: z.string().min(1),
  requestedLanguage: QueryLanguageSchema.nullable(),
});

// ---------------------------------------------------------------------------
// QueryDraft
// ---------------------------------------------------------------------------
export const QueryDraftSchema: z.ZodType<QueryDraft> = z.object({
  id: z.string().uuid(),
  analystQueryId: z.string().uuid(),
  language: QueryLanguageSchema,
  queryString: z.string().min(1),
  generatedAt: ISODateTimeSchema,
  generationAttempt: z.number().int().min(1),
  providerUsed: z.string().min(1),
  tokensUsed: z.number().int().nonnegative(),
  promptVersion: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type TimeRangeHintSchemaType = z.infer<typeof TimeRangeHintSchema>;
export type ExtractedEntitiesSchemaType = z.infer<typeof ExtractedEntitiesSchema>;
export type InvestigationIntentSchemaType = z.infer<typeof InvestigationIntentSchema>;
export type AnalystQuerySchemaType = z.infer<typeof AnalystQuerySchema>;
export type QueryDraftSchemaType = z.infer<typeof QueryDraftSchema>;
