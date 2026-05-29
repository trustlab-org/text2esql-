import type { PROVIDER_NAMES } from '../constants';

export type ProviderName = (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES];

export interface ProviderMetadata {
  readonly name: ProviderName;
  readonly displayName: string;
  readonly model: string;
  readonly supportsStreaming: boolean;
  readonly maxTokens: number;
  readonly baseUrl?: string;
  readonly apiVersion?: string;
  readonly capabilities: ProviderCapabilities;
}

export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly functionCalling: boolean;
  readonly jsonMode: boolean;
  readonly vision: boolean;
  readonly codeInterpreter: boolean;
}

export interface ProviderHealthStatus {
  readonly provider: ProviderName;
  readonly status: import('../constants').HealthStatus;
  readonly latencyMs: number | null;
  readonly lastCheckedAt: string; // ISO 8601
  readonly errorMessage: string | null;
  readonly consecutiveFailures: number;
  readonly modelAvailable: boolean;
}

export interface ProviderResponse {
  readonly provider: ProviderName;
  readonly model: string;
  readonly content: string;
  readonly finishReason: ProviderFinishReason;
  readonly usage: ProviderTokenUsage;
  readonly latencyMs: number;
  readonly requestId: string | null;
  readonly cached: boolean;
  readonly raw?: unknown;
}

export type ProviderFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_calls'
  | 'error'
  | 'unknown';

export interface ProviderTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface ProviderRequestConfig {
  readonly provider: ProviderName;
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly stream?: boolean;
  readonly systemPrompt?: string;
}
