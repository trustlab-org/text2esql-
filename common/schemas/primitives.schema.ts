/**
 * Zod enum primitives derived directly from constants objects.
 *
 * Pattern: z.enum([...Object.values(CONSTANT)] as [string, ...string[]])
 * This keeps Zod enums in sync with constants at the type level without
 * duplicating string literals. All other schema files import from here.
 */
import { z } from 'zod';
import {
  PROVIDER_NAMES,
  INVESTIGATION_TYPES,
  QUERY_LANGUAGES,
  OBSERVABILITY_EVENT_TYPES,
  HEALTH_STATUS,
  ERROR_CODES,
  ERROR_SEVERITY,
  ECS_FIELD_CATEGORIES,
  ECS_FIELD_TYPES,
} from '../constants';

// ---------------------------------------------------------------------------
// Helper — narrows Object.values() result to the non-empty tuple Zod requires
// ---------------------------------------------------------------------------
function toZodEnum<T extends string>(
  obj: Record<string, T>
): z.ZodEnum<[T, ...T[]]> {
  const values = Object.values(obj) as [T, ...T[]];
  return z.enum(values);
}

export const ProviderNameSchema = toZodEnum(PROVIDER_NAMES);
export const InvestigationTypeSchema = toZodEnum(INVESTIGATION_TYPES);
export const QueryLanguageSchema = toZodEnum(QUERY_LANGUAGES);
export const ObservabilityEventTypeSchema = toZodEnum(OBSERVABILITY_EVENT_TYPES);
export const HealthStatusSchema = toZodEnum(HEALTH_STATUS);
export const ErrorCodeSchema = toZodEnum(ERROR_CODES);
export const ErrorSeveritySchema = toZodEnum(ERROR_SEVERITY);
export const ECSFieldCategorySchema = toZodEnum(ECS_FIELD_CATEGORIES);
export const ECSFieldTypeSchema = toZodEnum(ECS_FIELD_TYPES);

// Literals not backed by a constants object
export const ConversationRoleSchema = z.enum(['user', 'assistant', 'system']);
export const ProviderFinishReasonSchema = z.enum([
  'stop',
  'length',
  'content_filter',
  'tool_calls',
  'error',
  'unknown',
]);
export const ECSNormalizationLevelSchema = z.enum(['core', 'extended', 'custom']);
export const CacheKeyStrategySchema = z.enum(['exact', 'normalized', 'semantic']);
export const PipelineStageSchema = z.enum([
  'intent_classification',
  'query_generation',
  'validation',
  'correction',
  'finalization',
]);
export const PipelineStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'aborted',
  'corrected',
]);

// ISO 8601 datetime — validates the string format, not just that it's a string
export const ISODateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Must be a valid ISO 8601 datetime string' });
