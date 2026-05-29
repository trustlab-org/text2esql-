import type { ProviderName, ProviderResponse } from './provider.types';
import type { AnalystQuery, QueryDraft, InvestigationIntent } from './intent.types';
import type { ValidationResult, CorrectionAttempt } from './validation.types';
import type { TokenEstimate, CostEstimate } from './cost.types';
import type { ObservabilityEvent } from './observability.types';

export type PipelineStage =
  | 'intent_classification'
  | 'query_generation'
  | 'validation'
  | 'correction'
  | 'finalization';

export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'aborted'
  | 'corrected';

export interface PipelineContext {
  readonly pipelineId: string;
  readonly sessionId: string;
  readonly analystQuery: AnalystQuery;
  readonly selectedProvider: ProviderName;
  readonly indexPattern: string;
  readonly conversationHistory: readonly ConversationMessage[];
  readonly startedAt: string; // ISO 8601
  readonly timeoutMs: number;
  readonly maxCorrectionAttempts: number;
  readonly requestMetadata: PipelineRequestMetadata;
}

export interface PipelineRequestMetadata {
  readonly userAgent: string | null;
  readonly kibanaVersion: string;
  readonly pluginVersion: string;
  readonly requestId: string;
}

export interface QueryPipelineResult {
  readonly pipelineId: string;
  readonly status: PipelineStatus;
  readonly analystQuery: AnalystQuery;
  readonly intent: InvestigationIntent | null;
  readonly drafts: readonly QueryDraft[];
  readonly finalQuery: QueryDraft | null;
  readonly validationResult: ValidationResult | null;
  readonly correctionAttempts: readonly CorrectionAttempt[];
  readonly providerResponses: readonly ProviderResponse[];
  readonly tokenEstimate: TokenEstimate;
  readonly costEstimate: CostEstimate;
  readonly events: readonly ObservabilityEvent[];
  readonly startedAt: string; // ISO 8601
  readonly completedAt: string | null; // ISO 8601
  readonly totalDurationMs: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

export interface ConversationMessage {
  readonly id: string;
  readonly role: ConversationRole;
  readonly content: string;
  readonly timestamp: string; // ISO 8601
  readonly pipelineId: string | null;
  readonly queryDraftId: string | null;
  readonly metadata: ConversationMessageMetadata;
}

export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationMessageMetadata {
  readonly tokensUsed: number | null;
  readonly provider: ProviderName | null;
  readonly model: string | null;
  readonly latencyMs: number | null;
}
