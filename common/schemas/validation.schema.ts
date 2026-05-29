import { z } from 'zod';
import { ErrorCodeSchema, ErrorSeveritySchema, QueryLanguageSchema, ISODateTimeSchema } from './primitives.schema';
import type { ValidationError, ValidationResult, CorrectionAttempt } from '../types';

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------
export const ValidationErrorSchema: z.ZodType<ValidationError> = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  field: z.string().nullable(),
  line: z.number().int().positive().nullable(),
  column: z.number().int().nonnegative().nullable(),
  severity: ErrorSeveritySchema,
  suggestion: z.string().nullable(),
  raw: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// ValidationResult
// ---------------------------------------------------------------------------
export const ValidationResultSchema: z.ZodType<ValidationResult> = z.object({
  isValid: z.boolean(),
  language: QueryLanguageSchema,
  errors: z.array(ValidationErrorSchema).readonly(),
  warnings: z.array(ValidationErrorSchema).readonly(),
  validatedAt: ISODateTimeSchema,
  validationDurationMs: z.number().nonnegative(),
});

// ---------------------------------------------------------------------------
// CorrectionAttempt
// ---------------------------------------------------------------------------
export const CorrectionAttemptSchema: z.ZodType<CorrectionAttempt> = z.object({
  attemptNumber: z.number().int().min(1),
  originalQuery: z.string().min(1),
  correctedQuery: z.string().min(1),
  errors: z.array(ValidationErrorSchema).readonly(),
  correctionReasoning: z.string().min(1),
  providerUsed: z.string().min(1),
  tokensUsed: z.number().int().nonnegative(),
  succeededValidation: z.boolean(),
  attemptedAt: ISODateTimeSchema,
  durationMs: z.number().nonnegative(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type ValidationErrorSchemaType = z.infer<typeof ValidationErrorSchema>;
export type ValidationResultSchemaType = z.infer<typeof ValidationResultSchema>;
export type CorrectionAttemptSchemaType = z.infer<typeof CorrectionAttemptSchema>;
