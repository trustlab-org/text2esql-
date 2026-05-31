import type { ProviderName } from '../../../common';
import type { TokenEstimate } from '../../../common/types';

// ---------------------------------------------------------------------------
// ProviderPrompt
//
// The normalised input contract every concrete provider receives.
// Callers never build provider-specific request shapes — they fill this struct
// and let the provider adapter translate it to the wire format.
// ---------------------------------------------------------------------------

export interface ProviderPrompt {
  readonly systemPrompt: string;
  readonly userMessage: string;
  /**
   * 0.0–2.0. Defaults handled per-provider if absent.
   * Lower values produce more deterministic outputs — recommended for query
   * generation where reproducibility matters.
   */
  readonly temperature?: number;
  /**
   * Token ceiling for the completion. Providers clip to their own hard max
   * if this exceeds it.
   */
  readonly maxTokens?: number;
}

// ---------------------------------------------------------------------------
// ProviderResponse
//
// The normalised output contract returned by every concrete provider.
// Raw wire responses are preserved in `rawResponse` for debugging and
// observability without polluting the domain layer with provider specifics.
// ---------------------------------------------------------------------------

export interface ProviderResponse {
  readonly content: string;
  readonly tokensUsed: TokenEstimate;
  readonly rawResponse: unknown;
  readonly latencyMs: number;
  readonly provider: ProviderName;
}

// ---------------------------------------------------------------------------
// ProviderMetadata
//
// Static descriptor for a provider instance.
// Used by the router to select, rank, and fall back across providers.
// ---------------------------------------------------------------------------

export type ProviderRole = 'primary' | 'fallback' | 'local';

export interface ProviderMetadata {
  readonly name: ProviderName;
  /**
   * Role controls router behaviour:
   *  primary  — tried first for every request
   *  fallback — tried when all primary providers fail
   *  local    — tried last; no network dependency (e.g. Ollama)
   */
  readonly role: ProviderRole;
  /**
   * Lower number = higher priority within the same role tier.
   * Providers with equal priority are tried in registration order.
   */
  readonly priority: number;
  readonly maxTokens: number;
}

// ---------------------------------------------------------------------------
// ILLMProvider
//
// The complete interface every provider adapter must satisfy.
// BaseProvider implements the infrastructure methods; concrete adapters
// implement the four abstract methods.
// ---------------------------------------------------------------------------

export interface ILLMProvider {
  /**
   * Send a prompt and return a normalised response.
   * Throws a ProviderError subclass on any failure.
   */
  complete(prompt: ProviderPrompt): Promise<ProviderResponse>;

  /**
   * Lightweight health probe — returns true if the provider is reachable
   * and the configured model is available.
   * Must not throw; returns false on any failure.
   */
  isHealthy(): Promise<boolean>;

  /** Static descriptor used by the router for selection and ranking. */
  getMetadata(): ProviderMetadata;

  /**
   * Cheap pre-flight token estimate for a raw string.
   * Used for context-window checks before spending an API call.
   * Implementations may use heuristics (e.g. chars / 4) or a proper tokeniser.
   */
  estimateTokens(text: string): number;
}
