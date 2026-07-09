import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  AuthenticationError,
  RateLimitError,
  InternalServerError,
  PermissionDeniedError,
  BadRequestError,
  APIError,
  APIUserAbortError,
} from 'openai';
import { BaseProvider } from '../base.provider';
import type { ProviderPrompt, ProviderResponse, ProviderMetadata } from '../types';
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderAuthError,
  ProviderTimeoutError,
  ProviderContextOverflowError,
  ProviderUnavailableError,
} from '../errors';
import { PROVIDER_NAMES } from '../../../../common';
import { OpenAIAdapter } from './openai.adapter';
import type { OpenAIConfig } from './openai.config';
import {
  OPENAI_MAX_RETRIES,
  OPENAI_RETRY_BASE_DELAY_MS,
} from './openai.config';

/**
 * OpenAIProvider
 *
 * Fallback provider adapter for OpenAI GPT models (priority 5).
 * Extends BaseProvider for retry, timeout, and error normalisation.
 *
 * Uses the official openai SDK with SDK-level retries disabled so
 * BaseProvider.retry() owns all retry decisions and backoff timing.
 *
 * API contract:
 *  - System prompt → { role: 'system', content } as first message
 *  - User message  → { role: 'user', content } as second message
 *  - stream: false — always wait for the full completion
 *
 * Health check:
 *  models.retrieve(config.model) — validates the API key and confirms the
 *  specified model is accessible on this account. No token spend.
 *
 * Error classification (mirrors GroqProvider — same OpenAI-compatible SDK):
 *  - 429 / RateLimitError          → ProviderRateLimitError  (aborts retry)
 *  - 401 / AuthenticationError     → ProviderAuthError       (aborts retry)
 *  - 403 / PermissionDeniedError   → ProviderAuthError       (aborts retry)
 *  - 400 / BadRequestError         → ProviderContextOverflowError if token-related
 *                                    else non-retryable ProviderError
 *  - 5xx / InternalServerError     → ProviderUnavailableError (retryable)
 *  - APIConnectionTimeoutError     → ProviderTimeoutError     (retryable)
 *  - APIConnectionError            → ProviderUnavailableError (retryable)
 *  - APIUserAbortError             → ProviderTimeoutError     (from withTimeout)
 */
export class OpenAIProvider extends BaseProvider {
  private readonly client: OpenAI;
  private readonly adapter: OpenAIAdapter;
  private readonly config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    super();
    this.config = config;
    this.adapter = new OpenAIAdapter();

    this.client = new OpenAI({
      apiKey: config.apiKey,
      maxRetries: 0, // BaseProvider.retry() owns retries
      timeout: config.timeoutMs, // belt-and-suspenders alongside withTimeout()
      ...(config.baseURL !== undefined && { baseURL: config.baseURL }),
      ...(config.organization !== undefined && { organization: config.organization }),
      ...(config.project !== undefined && { project: config.project }),
    });
  }

  // ---------------------------------------------------------------------------
  // ILLMProvider
  // ---------------------------------------------------------------------------

  public getMetadata(): ProviderMetadata {
    return {
      name: PROVIDER_NAMES.OPENAI,
      role: 'fallback',
      priority: 5,
      maxTokens: this.config.maxTokens,
    };
  }

  /**
   * Sends a prompt to GPT and returns a normalised ProviderResponse.
   */
  public async complete(prompt: ProviderPrompt): Promise<ProviderResponse> {
    return this.retry(
      () => this.executeComplete(prompt),
      OPENAI_MAX_RETRIES,
      OPENAI_RETRY_BASE_DELAY_MS
    );
  }

  /**
   * Synchronous token estimator.
   *
   * GPT-family models use cl100k_base (GPT-4, GPT-4o) or o200k_base (GPT-4o-2024*).
   * The tiktoken library gives exact counts but requires WASM and is expensive
   * to init per-provider. The chars/4 heuristic is accurate to ±15% on English
   * text and is sufficient for context-window pre-flight guards.
   *
   * Callers needing exact counts should use tiktoken externally and pass
   * pre-computed values via the prompt's maxTokens field.
   */
  public estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Health check: retrieves the configured model metadata.
   * models.retrieve() validates the API key and confirms the model is accessible
   * on this account tier — free-tier accounts cannot use gpt-4o.
   * No token spend; returns false on any error without throwing.
   */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.withTimeout(
        () => this.client.models.retrieve(this.config.model),
        Math.min(this.config.timeoutMs, 10_000)
      );
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async executeComplete(prompt: ProviderPrompt): Promise<ProviderResponse> {
    const startMs = Date.now();

    let completion: OpenAI.ChatCompletion;

    try {
      completion = await this.withTimeout(
        () =>
          this.client.chat.completions.create({
            model: this.config.model,
            messages: [
              { role: 'system', content: prompt.systemPrompt },
              { role: 'user', content: prompt.userMessage },
            ],
            temperature: prompt.temperature ?? this.config.temperature,
            max_completion_tokens: prompt.maxTokens ?? this.config.maxTokens,
            stream: false,
          }),
        this.config.timeoutMs
      );
    } catch (err) {
      throw this.classifyError(err);
    }

    const latencyMs = Date.now() - startMs;
    const response = this.adapter.adaptChatCompletion(completion, latencyMs);

    if (response.content.trim().length === 0) {
      const finishReason = completion.choices[0]?.finish_reason;
      throw new ProviderUnavailableError(
        PROVIDER_NAMES.OPENAI,
        `Model returned empty content (finish_reason: ${finishReason ?? 'unknown'})`,
        { retryable: finishReason !== 'content_filter' }
      );
    }

    return response;
  }

  /**
   * Classifies OpenAI SDK exceptions into typed ProviderErrors.
   * Error hierarchy mirrors GroqProvider — both use OpenAI-compatible SDKs.
   */
  private classifyError(err: unknown): ProviderError {
    if (err instanceof ProviderError) return err;

    if (err instanceof APIUserAbortError) {
      return new ProviderTimeoutError(PROVIDER_NAMES.OPENAI, this.config.timeoutMs, {
        cause: err,
      });
    }

    if (err instanceof APIConnectionTimeoutError) {
      return new ProviderTimeoutError(PROVIDER_NAMES.OPENAI, this.config.timeoutMs, {
        cause: err,
      });
    }

    if (err instanceof APIConnectionError) {
      return new ProviderUnavailableError(
        PROVIDER_NAMES.OPENAI,
        err.message,
        { retryable: true, cause: err }
      );
    }

    if (err instanceof APIError) {
      const status = err.status;

      if (err instanceof RateLimitError) {
        const retryAfterMs = this.extractRetryAfterMs(err);
        return new ProviderRateLimitError(PROVIDER_NAMES.OPENAI, {
          retryAfterMs,
          cause: err,
        });
      }

      if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
        return new ProviderAuthError(PROVIDER_NAMES.OPENAI, { cause: err });
      }

      if (err instanceof BadRequestError) {
        const msg = err.message.toLowerCase();
        if (msg.includes('context') || msg.includes('token') || msg.includes('length')) {
          return new ProviderContextOverflowError(
            PROVIDER_NAMES.OPENAI,
            0,
            this.config.maxTokens,
            { cause: err }
          );
        }
        return new ProviderError(
          `OpenAI bad request: ${err.message}`,
          PROVIDER_NAMES.OPENAI,
          { retryable: false, statusCode: 400, cause: err }
        );
      }

      if (err instanceof InternalServerError) {
        return new ProviderUnavailableError(
          PROVIDER_NAMES.OPENAI,
          err.message,
          { retryable: true, statusCode: status ?? 500, cause: err }
        );
      }

      return this.normalizeError(err);
    }

    return this.normalizeError(err);
  }

  /**
   * Parses Retry-After from OpenAI rate-limit error headers.
   * OpenAI includes `retry-after` (seconds), `x-ratelimit-reset-requests`,
   * and `x-ratelimit-reset-tokens` headers on 429 responses.
   */
  private extractRetryAfterMs(err: APIError): number | null {
    try {
      const headers = err.headers as Record<string, string> | undefined;
      if (!headers) return null;

      // Prefer the explicit retry-after header; fall back to reset timestamps
      const candidates = [
        headers['retry-after'],
        headers['Retry-After'],
        headers['x-ratelimit-reset-requests'],
        headers['x-ratelimit-reset-tokens'],
      ];

      for (const value of candidates) {
        if (value === undefined) continue;
        const seconds = parseFloat(value);
        if (!isNaN(seconds)) return Math.ceil(seconds * 1000);
        const date = new Date(value).getTime();
        if (!isNaN(date)) return Math.max(0, date - Date.now());
      }
    } catch {
      // Parsing failed
    }
    return null;
  }
}
