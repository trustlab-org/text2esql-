import Groq, {
  APIConnectionTimeoutError,
  APIConnectionError,
  AuthenticationError,
  RateLimitError,
  InternalServerError,
  PermissionDeniedError,
  BadRequestError,
  APIError,
} from 'groq-sdk';
//import type { ChatCompletionCreateParamsNonStreaming } from 'groq-sdk/resources/chat/completions';
import { PROVIDER_NAMES } from '../../../../common';
import { BaseProvider } from '../base.provider';
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderAuthError,
  ProviderTimeoutError,
  ProviderContextOverflowError,
  ProviderUnavailableError,
} from '../errors';
import type { ProviderPrompt, ProviderResponse, ProviderMetadata } from '../types';
import type { GroqConfig } from './groq.config';
import { adaptGroqCompletion } from './groq.adapter';
type ChatCompletionCreateParamsNonStreaming = any;

// ---------------------------------------------------------------------------
// Retry configuration
// ---------------------------------------------------------------------------

const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 500;

// ---------------------------------------------------------------------------
// GroqProvider
// ---------------------------------------------------------------------------

/**
 * Groq fallback provider adapter.
 *
 * Groq exposes an OpenAI-compatible chat completions API served over HTTP.
 * The groq-sdk is a thin wrapper that handles auth, retries (disabled here —
 * we use BaseProvider.retry() instead), and typed responses.
 *
 * Lifecycle:
 *  1. Constructed with a GroqConfig snapshot from ConfigService.
 *  2. Groq SDK client is instantiated in the constructor with maxRetries:0
 *     so BaseProvider.retry() owns all retry logic.
 *  3. complete() wraps chat.completions.create in withTimeout() + retry().
 *  4. isHealthy() calls models.list() — lightweight, no token spend.
 *  5. estimateTokens() uses the cl100k_base heuristic (chars/4) — acceptable
 *     approximation for Llama models; accurate enough for context-window guards.
 *
 * Retry policy (mirrors GeminiProvider):
 *  - ProviderRateLimitError (429): abort retry immediately — router falls back.
 *  - ProviderAuthError (401): abort retry immediately.
 *  - ProviderTimeoutError: retryable — transient network condition.
 *  - InternalServerError (5xx): retryable.
 */
export class GroqProvider extends BaseProvider {
  private readonly config: GroqConfig;
  private readonly client: Groq;

  constructor(config: GroqConfig) {
    super();
    this.config = config;

    // Disable the SDK's built-in retries — BaseProvider.retry() owns that logic.
    // Pass timeout to the SDK as well so the HTTP layer enforces it independently
    // of our withTimeout() wrapper (belt-and-suspenders).
    this.client = new Groq({
      apiKey: config.apiKey,
      maxRetries: 0,
      timeout: config.timeoutMs,
    });
  }

  // ── ILLMProvider ──────────────────────────────────────────────────────────

  public getMetadata(): ProviderMetadata {
    return {
      name: PROVIDER_NAMES.GROQ,
      role: 'primary',
      priority: 1,
      maxTokens: this.config.maxTokens,
    };
  }

  /**
   * Send a prompt to Groq and return a normalised ProviderResponse.
   *
   * Strategy:
   *  - Pre-flight token estimate — reject if combined tokens exceed context window.
   *  - Wrap the SDK call in withTimeout() + retry() from BaseProvider.
   *  - Rate-limit (429) and auth (401) errors abort immediately without retrying.
   */
  public async complete(prompt: ProviderPrompt): Promise<ProviderResponse> {
    // ── Pre-flight token estimate ──────────────────────────────────────────
    const estimatedInputTokens = this.estimateTokens(
      prompt.systemPrompt + '\n' + prompt.userMessage
    );
    const maxTokens = prompt.maxTokens ?? this.config.maxTokens;

    if (estimatedInputTokens + maxTokens > this.config.maxTokens) {
      throw new ProviderContextOverflowError(
        PROVIDER_NAMES.GROQ,
        estimatedInputTokens + maxTokens,
        this.config.maxTokens
      );
    }

    const temperature = prompt.temperature ?? this.config.temperature;
    const timeoutMs = this.config.timeoutMs;

    return this.retry(
      () =>
        this.withTimeout(
          () => this.callChatCompletions(prompt, temperature, maxTokens),
          timeoutMs
        ),
      MAX_RETRIES,
      BASE_RETRY_DELAY_MS
    );
  }

  /**
   * Synchronous token estimator.
   *
   * Groq serves Llama-family models which use a SentencePiece tokeniser.
   * cl100k_base (tiktoken) is not a perfect match, but the chars/4 heuristic
   * is a reasonable approximation for context-window guards — Llama tokenisation
   * is similarly ~4 chars/token on English text.
   *
   * If sub-token accuracy is needed, replace with the @dqbd/tiktoken package
   * (WASM-based, works in Node) and encode with 'cl100k_base'.
   */
  public estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Health check: calls models.list() to verify API key validity and
   * service reachability without spending any tokens.
   *
   * Returns false on any error — never throws.
   */
  public async isHealthy(): Promise<boolean> {
    try {
      await this.withTimeout(
        () => this.client.models.list(),
        Math.min(this.config.timeoutMs, 5000)
      );
      return true;
    } catch {
      return false;
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Core SDK call — isolated so retry() wraps only the network I/O.
   */
  private async callChatCompletions(
    prompt: ProviderPrompt,
    temperature: number,
    maxTokens: number
  ): Promise<ProviderResponse> {
    const startMs = Date.now();

    const body: ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages: [
        { role: 'system', content: prompt.systemPrompt },
        { role: 'user', content: prompt.userMessage },
      ],
      temperature,
      max_tokens: maxTokens,
      stream: false,
    };

    try {
      const completion = await this.client.chat.completions.create(body);
      const latencyMs = Date.now() - startMs;

      const fallbackPromptTokens = this.estimateTokens(
        prompt.systemPrompt + ' ' + prompt.userMessage
      );
      const fallbackCompletionTokens = this.estimateTokens(
        completion.choices[0]?.message?.content ?? ''
      );

      return adaptGroqCompletion({
        completion,
        latencyMs,
        fallbackPromptTokens,
        fallbackCompletionTokens,
      });
    } catch (err) {
      throw this.normalizeGroqError(err);
    }
  }

  /**
   * Groq-specific error normalisation.
   *
   * groq-sdk error hierarchy (all extend APIError which extends Error):
   *  - RateLimitError            → 429 → ProviderRateLimitError
   *  - AuthenticationError       → 401 → ProviderAuthError
   *  - PermissionDeniedError     → 403 → ProviderAuthError
   *  - BadRequestError           → 400 → ProviderContextOverflowError (if token-related)
   *                                    → ProviderError non-retryable otherwise
   *  - InternalServerError       → 5xx → ProviderUnavailableError retryable
   *  - APIConnectionTimeoutError →     → ProviderTimeoutError retryable
   *  - APIConnectionError        →     → ProviderUnavailableError retryable
   *  - Everything else           →     → BaseProvider.normalizeError()
   *
   * Rate-limit and auth errors abort retry() immediately (retryable:false /
   * the retry wrapper checks instanceof before sleeping).
   */
  private normalizeGroqError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    // SDK timeout — groq-sdk throws this when the SDK-level timeout fires.
    // Our withTimeout() wrapper will also produce ProviderTimeoutError via
    // BaseProvider.normalizeError() for AbortErrors, but this handles the
    // SDK's own timeout path explicitly.
    if (error instanceof APIConnectionTimeoutError) {
      return new ProviderTimeoutError(PROVIDER_NAMES.GROQ, this.config.timeoutMs, {
        cause: error,
      });
    }

    // Network-level connection failure (DNS, ECONNREFUSED, etc.)
    if (error instanceof APIConnectionError) {
      return new ProviderUnavailableError(
        PROVIDER_NAMES.GROQ,
        error.message,
        { retryable: true, cause: error }
      );
    }

    // HTTP API errors — all extend APIError and carry a .status field
    if (error instanceof APIError) {
      const status = error.status;

      if (error instanceof RateLimitError) {
        // Not retried by GeminiProvider pattern — router falls back immediately
        return new ProviderRateLimitError(PROVIDER_NAMES.GROQ, { cause: error });
      }

      if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
        return new ProviderAuthError(PROVIDER_NAMES.GROQ, { cause: error });
      }

      if (error instanceof BadRequestError) {
        // 400 with context-overflow message → ProviderContextOverflowError
        const msg = error.message.toLowerCase();
        if (msg.includes('context') || msg.includes('token') || msg.includes('length')) {
          return new ProviderContextOverflowError(
            PROVIDER_NAMES.GROQ,
            0, // exact counts unavailable at this point
            this.config.maxTokens,
            { cause: error }
          );
        }
        return new ProviderError(
          `Groq bad request: ${error.message}`,
          PROVIDER_NAMES.GROQ,
          { retryable: false, statusCode: 400, cause: error }
        );
      }

      if (error instanceof InternalServerError) {
        return new ProviderUnavailableError(
          PROVIDER_NAMES.GROQ,
          error.message,
          { retryable: true, statusCode: status ?? 500, cause: error }
        );
      }

      // Any other APIError with a status code — delegate to BaseProvider mapping
      return this.normalizeError(error);
    }

    // Everything else — BaseProvider handles AbortError, network errnos, unknown
    return this.normalizeError(error);
  }
}
