import type { INVESTIGATION_TYPES, QueryLanguage } from '../constants';
import type { ECSField } from './ecs.types';

export type InvestigationType =
  (typeof INVESTIGATION_TYPES)[keyof typeof INVESTIGATION_TYPES];

export type { QueryLanguage };

export interface InvestigationIntent {
  readonly type: InvestigationType;
  readonly confidence: number; // 0.0 – 1.0
  readonly reasoning: string;
  readonly suggestedFields: readonly ECSField[];
  readonly suggestedQueryLanguage: QueryLanguage;
  readonly timeRangeHint: TimeRangeHint | null;
  readonly entitiesExtracted: ExtractedEntities;
}

export interface TimeRangeHint {
  readonly relative?: string; // e.g. "last 24h", "last 7 days"
  readonly from?: string; // ISO 8601
  readonly to?: string; // ISO 8601
}

export interface ExtractedEntities {
  readonly ipAddresses: readonly string[];
  readonly hostnames: readonly string[];
  readonly usernames: readonly string[];
  readonly processNames: readonly string[];
  readonly filePaths: readonly string[];
  readonly hashes: readonly string[];
  readonly domains: readonly string[];
  readonly ports: readonly number[];
}

export interface AnalystQuery {
  readonly id: string;
  readonly rawInput: string;
  readonly normalizedInput: string;
  readonly timestamp: string; // ISO 8601
  readonly intent: InvestigationIntent | null;
  readonly sessionId: string;
  readonly indexPattern: string;
  readonly requestedLanguage: QueryLanguage | null;
}

export interface QueryDraft {
  readonly id: string;
  readonly analystQueryId: string;
  readonly language: QueryLanguage;
  readonly queryString: string;
  readonly generatedAt: string; // ISO 8601
  readonly generationAttempt: number;
  readonly providerUsed: string;
  readonly tokensUsed: number;
  readonly promptVersion: string;
}
