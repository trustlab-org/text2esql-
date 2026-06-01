import type { ObservabilityEventType, ErrorSeverity } from '../constants';
import type { ProviderName } from './provider.types';

export interface ObservabilityEvent {
  readonly eventId: string;
  readonly type: ObservabilityEventType;
  readonly pipelineId: string;
  readonly sessionId: string;
  readonly timestamp: string; // ISO 8601
  readonly durationMs: number | null;
  readonly severity: ErrorSeverity;
  readonly provider: ProviderName | null;
  readonly stage: string | null;
  readonly payload: ObservabilityEventPayload;
  readonly tags: readonly string[];
}

export type ObservabilityEventPayload =
  | QueryGeneratedPayload
  | QueryValidatedPayload
  | QueryCorrectedPayload
  | QueryFailedPayload
  | ProviderRequestPayload
  | ProviderResponsePayload
  | ProviderErrorPayload
  | CacheEventPayload
  | PipelineEventPayload
  | IntentClassifiedPayload;

export interface QueryGeneratedPayload {
  readonly kind: 'query_generated';
  readonly language: string;
  readonly queryLength: number;
  readonly attemptNumber: number;
  readonly promptTokens: number;
}

export interface QueryValidatedPayload {
  readonly kind: 'query_validated';
  readonly isValid: boolean;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly validationDurationMs: number;
}

export interface QueryCorrectedPayload {
  readonly kind: 'query_corrected';
  readonly attemptNumber: number;
  readonly succeeded: boolean;
  readonly errorsAddressed: number;
}

export interface QueryFailedPayload {
  readonly kind: 'query_failed';
  readonly errorCode: string;
  readonly stage: string;
  readonly maxAttemptsReached: boolean;
}

export interface ProviderRequestPayload {
  readonly kind: 'provider_request';
  readonly provider: ProviderName;
  readonly model: string;
  readonly promptTokenEstimate: number;
  readonly stream: boolean;
}

export interface ProviderResponsePayload {
  readonly kind: 'provider_response';
  readonly provider: ProviderName;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly latencyMs: number;
  readonly cached: boolean;
  readonly finishReason: string;
}

export interface ProviderErrorPayload {
  readonly kind: 'provider_error';
  readonly provider: ProviderName;
  readonly errorCode: string;
  readonly statusCode: number | null;
  readonly retryable: boolean;
}

export interface CacheEventPayload {
  readonly kind: 'cache_hit' | 'cache_miss';
  readonly keyHash: string;
  readonly ttlRemainingSeconds?: number;
}

export interface PipelineEventPayload {
  readonly kind: 'pipeline_start' | 'pipeline_complete' | 'pipeline_abort';
  readonly totalDurationMs?: number;
  readonly stagesCompleted?: readonly string[];
  readonly abortReason?: string;
  /** Estimated USD cost of the run; accumulated by MetricsService on pipeline_complete. */
  readonly costUsd?: number;
}

export interface IntentClassifiedPayload {
  readonly kind: 'intent_classified';
  readonly investigationType: string;
  readonly confidence: number;
  readonly suggestedLanguage: string;
}
