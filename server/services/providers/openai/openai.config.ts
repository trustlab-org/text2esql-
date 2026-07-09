import { PROVIDER_DEFAULT_MODELS, PROVIDER_MAX_TOKENS } from '../../../../common';

/**
 * Configuration contract for the OpenAI provider instance.
 * Sourced from Kibana config (server/config.ts → providers.openai).
 */
export interface OpenAIConfig {
  /** OpenAI API key — never logged. */
  readonly apiKey: string;
  /** Model identifier, e.g. "gpt-4o", "gpt-4o-mini". */
  readonly model: string;
  /** Maximum completion tokens. Maps to max_completion_tokens in the API. */
  readonly maxTokens: number;
  /** Per-request timeout in milliseconds. */
  readonly timeoutMs: number;
  /**
   * Sampling temperature — 0.0 to 2.0.
   * 0.0–0.2 recommended for deterministic query generation.
   */
  readonly temperature: number;
  /** Optional OpenAI organization ID for usage attribution. */
  readonly organization?: string;
  /** Optional OpenAI project ID. */
  readonly project?: string;
  /**
   * Optional custom base URL for OpenAI-COMPATIBLE servers (vLLM, TGI, LocalAI,
   * LM Studio, …). When set, the SDK targets this instead of
   * https://api.openai.com/v1. Include the /v1 suffix, e.g.
   * "http://10.129.7.88:8102/v1". Undefined → the SDK's api.openai.com default.
   */
  readonly baseURL?: string;
}

export const OPENAI_DEFAULTS = {
  model: PROVIDER_DEFAULT_MODELS.openai,
  maxTokens: PROVIDER_MAX_TOKENS.openai,
  timeoutMs: 60_000,
  temperature: 0.2,
} as const satisfies Omit<OpenAIConfig, 'apiKey' | 'organization' | 'project'>;

/** Maximum retries for transient non-rate-limit errors. */
export const OPENAI_MAX_RETRIES = 2;
export const OPENAI_RETRY_BASE_DELAY_MS = 500;
