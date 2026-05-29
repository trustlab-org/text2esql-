import type { ErrorCode, ErrorSeverity } from '../constants';
import type { QueryLanguage } from './intent.types';

export interface ValidationError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly field: string | null;
  readonly line: number | null;
  readonly column: number | null;
  readonly severity: ErrorSeverity;
  readonly suggestion: string | null;
  readonly raw?: unknown;
}

export interface ValidationResult {
  readonly isValid: boolean;
  readonly language: QueryLanguage;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
  readonly validatedAt: string; // ISO 8601
  readonly validationDurationMs: number;
}

export interface CorrectionAttempt {
  readonly attemptNumber: number;
  readonly originalQuery: string;
  readonly correctedQuery: string;
  readonly errors: readonly ValidationError[];
  readonly correctionReasoning: string;
  readonly providerUsed: string;
  readonly tokensUsed: number;
  readonly succeededValidation: boolean;
  readonly attemptedAt: string; // ISO 8601
  readonly durationMs: number;
}
