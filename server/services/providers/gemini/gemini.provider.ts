import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  GoogleGenerativeAIAbortError,
  GoogleGenerativeAIResponseError,
  HarmCategory,
  HarmBlockThreshold,
} from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import { BaseProvider } from '../base.provider';
import type {
  ProviderPrompt,
  ProviderResponse,
  ProviderMetadata,
  ProviderModelValidationResult,
} from '../types';
import {
  ProviderRateLimitError,
  ProviderAuthError,
  ProviderContextOverflowError,
  ProviderUnavailableError,
} from '../errors';
import { PROVIDER_NAMES } from '../../../../common';
import { GeminiAdapter } from './gemini.adapter';
import type { GeminiConfig } from './gemini.config';
import {
  GEMINI_SAFETY_SETTINGS,
  GEMINI_MAX_RETRIES,
  GEMINI_RETRY_BASE_DELAY_MS,
  GEMINI_HEALTH_PROBE_TEXT,
  GEMINI_API_BASE_URL,
  GEMINI_MODEL_VALIDATION_TIMEOUT_MS,
} from './gemini.config';

/**
 * GeminiProvider
 *
 * Concrete provider adapter for Google Gemini models.
 * Extends BaseProvider for retry, timeout, and error normalisation infrastructure.
 *
 * Lifecycle:
 *  1. complete()   — sends a system + user message pair via generateContent().
 *                    Wraps in withTimeout(), retries transient failures via retry().
 *  2. isHealthy()  — makes a minimal countTokens probe to verify the API key and
 *                    model availability without generating a completion.
 *  3. estimateTokens() — delegates to SDK's countTokens() for accurate pre-flight
 *                    estimates; falls back to the heuristic (chars / 4) on failure.
 *
 * Error classification:
 *  - HTTP 429          → ProviderRateLimitError (not retried by retry() — handled upstream)
 *  - HTTP 401/403      → ProviderAuthError (not retried)
 *  - HTTP 422          → ProviderContextOverflowError (not retried)
 *  - AbortError        → ProviderTimeoutError (wrapped in withTimeout)
 *  - Safety block      → ProviderUnavailableError with descriptive message
 *  - All others        → delegated to BaseProvider.normalizeError()
 */
export class GeminiProvider extends BaseProvider {
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly adapter: GeminiAdapter;
  private readonly config: GeminiConfig;

  /**
   * Cached typed error set by validateModelAvailability() when startup discovery
   * AFFIRMATIVELY reports the configured model is unavailable for generateContent.
   * When non-null it short-circuits complete() and isHealthy() so we never repeat
   * the runtime 404 on every request. null = no known problem (default).
   */
  private modelUnavailableError: ProviderUnavailableError | null = null;

  constructor(config: GeminiConfig) {
    super();
    this.config = config;
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = this.client.getGenerativeModel(
      {
        model: config.model,
        systemInstruction: undefined, // Set per-request in complete()
        safetySettings: GEMINI_SAFETY_SETTINGS.map((s) => ({
          category: HarmCategory[s.category as keyof typeof HarmCategory],
          threshold: HarmBlockThreshold[s.threshold as keyof typeof HarmBlockThreshold],
        })),
        generationConfig: {
          maxOutputTokens: config.maxTokens,
          temperature: config.temperature,
          candidateCount: 1,
        },
      }
    );
    this.adapter = new GeminiAdapter();
  }

  // ---------------------------------------------------------------------------
  // ILLMProvider — required implementations
  // ---------------------------------------------------------------------------

  /**
   * Sends a prompt to Gemini and returns the normalised ProviderResponse.
   *
   * Gemini does not have a first-class "system message" in the messages array;
   * instead it accepts `systemInstruction` at the model level. Because we set
   * system prompts per-request, we create a fresh GenerativeModel instance
   * scoped to this call rather than mutating the shared this.model.
   */
  public async complete(prompt: ProviderPrompt): Promise<ProviderResponse> {
    // Short-circuit: if startup discovery affirmatively determined the configured
    // model is not available for generateContent, throw the cached typed error
    // BEFORE any network call so we never repeatedly hit the upstream 404.
    if (this.modelUnavailableError !== null) {
      throw this.modelUnavailableError;
    }
    return this.retry(
      () => this.executeComplete(prompt),
      GEMINI_MAX_RETRIES,
      GEMINI_RETRY_BASE_DELAY_MS
    );
  }

  /**
   * Lightweight health probe — counts tokens on a minimal string.
   * countTokens() validates the API key and model availability without billing
   * for a completion. Returns false on any error rather than throwing.
   */
  public async isHealthy(): Promise<boolean> {
    // If startup discovery flagged the configured model as unavailable, report
    // unhealthy immediately without a network probe.
    if (this.modelUnavailableError !== null) {
      return false;
    }
    try {
      await this.withTimeout(
        () => this.model.countTokens(GEMINI_HEALTH_PROBE_TEXT),
        this.config.timeoutMs
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the static metadata used by the provider router for selection and ranking.
   */
  public getMetadata(): ProviderMetadata {
    return {
      name: PROVIDER_NAMES.GEMINI,
      role: 'fallback',
      priority: 2,
      maxTokens: this.config.maxTokens,
    };
  }

  /**
   * Startup model-availability check.
   *
   * The legacy @google/generative-ai SDK does not expose listModels() on the
   * GoogleGenerativeAI client, so we discover models directly via the v1beta
   * REST endpoint (GET /models?key=...). We keep only models whose
   * supportedGenerationMethods include 'generateContent', strip the "models/"
   * prefix, and check whether the configured model is among them.
   *
   * Conservative failure handling: a network error, non-2xx (including 401/403
   * or transient 5xx), or an unparseable body must NOT mark the model
   * unavailable — discovery is purely advisory and a flaky probe should never
   * block an otherwise-valid model. In those cases we leave modelUnavailableError
   * untouched (null) and return { available: true, supportedModels: [] } so the
   * caller can log "discovery unavailable, proceeding". Only an AFFIRMATIVE
   * "model not in the returned list" sets the cached typed error. A genuinely
   * bad key surfaces as ProviderAuthError on the first real request instead.
   */
  public async validateModelAvailability(): Promise<ProviderModelValidationResult> {
    const configuredModel = this.stripModelPrefix(this.config.model);

    let supportedModels: string[];
    try {
      supportedModels = await this.discoverGenerateContentModels();
    } catch {
      // Discovery failed (network/timeout/non-2xx/parse). Treat as advisory —
      // do not mark unavailable; let a real request surface any true error.
      return { configuredModel, available: true, supportedModels: [] };
    }

    const available = supportedModels.includes(configuredModel);

    if (!available) {
      const preview = supportedModels.slice(0, 15).join(', ');
      this.modelUnavailableError = new ProviderUnavailableError(
        PROVIDER_NAMES.GEMINI,
        `Configured Gemini model "${this.config.model}" is not available for generateContent on this API key. ` +
          `Available models: ${preview}${supportedModels.length > 15 ? ', …' : ''}`,
        { retryable: false }
      );
    } else {
      this.modelUnavailableError = null;
    }

    return { configuredModel, available, supportedModels };
  }

  /**
   * Uses the SDK's countTokens() for an accurate pre-flight token estimate.
   * Falls back to the BaseProvider heuristic (chars / 4) if the API call fails
   * to avoid blocking the pipeline on a counting failure.
   *
   * Note: This is an async operation — we return synchronously from the interface
   * method using the heuristic, and expose an async variant for callers that can
   * afford to await.
   */
  public override estimateTokens(text: string): number {
    // Synchronous heuristic — satisfies ILLMProvider contract.
    // Use estimateTokensAsync() for accurate SDK-based counts when latency allows.
    return super.estimateTokens(text);
  }

  /**
   * Accurate async token estimation via SDK countTokens().
   * Returns the heuristic estimate on failure to remain non-blocking.
   */
  public async estimateTokensAsync(text: string): Promise<number> {
    try {
      const result = await this.withTimeout(
        () => this.model.countTokens(text),
        5_000 // Short timeout — this is a pre-flight check, not a generation
      );
      return result.totalTokens;
    } catch {
      return super.estimateTokens(text);
    }
  }

  // ---------------------------------------------------------------------------
  // Private implementation
  // ---------------------------------------------------------------------------

  /**
   * Discovers models that support generateContent via the v1beta REST listModels
   * endpoint. Returns model ids with the leading "models/" prefix stripped.
   * Throws on any failure (network, timeout, non-2xx, parse) — the caller treats
   * a throw as "discovery unavailable" rather than "model unavailable".
   */
  private async discoverGenerateContentModels(): Promise<string[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_MODEL_VALIDATION_TIMEOUT_MS);

    try {
      const url = `${GEMINI_API_BASE_URL}/models?key=${this.config.apiKey}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`listModels returned HTTP ${res.status}`);
      }

      const body: unknown = await res.json();
      return this.parseSupportedModels(body);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Narrows the unknown REST body to the model list and extracts the ids of
   * models supporting generateContent (prefix-stripped). No `any`.
   */
  private parseSupportedModels(body: unknown): string[] {
    if (body === null || typeof body !== 'object' || !('models' in body)) {
      return [];
    }

    const models = (body as { models?: unknown }).models;
    if (!Array.isArray(models)) {
      return [];
    }

    const result: string[] = [];
    for (const entry of models) {
      if (entry === null || typeof entry !== 'object') continue;
      const name = (entry as { name?: unknown }).name;
      const methods = (entry as { supportedGenerationMethods?: unknown })
        .supportedGenerationMethods;
      if (
        typeof name === 'string' &&
        Array.isArray(methods) &&
        methods.includes('generateContent')
      ) {
        result.push(this.stripModelPrefix(name));
      }
    }
    return result;
  }

  /** Strips a leading "models/" prefix so ids compare consistently. */
  private stripModelPrefix(model: string): string {
    return model.startsWith('models/') ? model.slice('models/'.length) : model;
  }

  /**
   * Core generation logic — called by complete() inside the retry wrapper.
   * Creates a request-scoped GenerativeModel with the per-request systemInstruction
   * to avoid mutating shared state.
   */
  private async executeComplete(prompt: ProviderPrompt): Promise<ProviderResponse> {
    // Build a request-scoped model with this prompt's system instruction.
    // getGenerativeModel() is cheap — it does not make a network call.
    const requestModel = this.client.getGenerativeModel({
      model: this.config.model,
      systemInstruction: prompt.systemPrompt,
      safetySettings: GEMINI_SAFETY_SETTINGS.map((s) => ({
        category: HarmCategory[s.category as keyof typeof HarmCategory],
        threshold: HarmBlockThreshold[s.threshold as keyof typeof HarmBlockThreshold],
      })),
      generationConfig: {
        maxOutputTokens: prompt.maxTokens ?? this.config.maxTokens,
        temperature: prompt.temperature ?? this.config.temperature,
        candidateCount: 1,
      },
    });

    const startMs = Date.now();

    let rawResult: Awaited<ReturnType<typeof requestModel.generateContent>>;

    try {
      rawResult = await this.withTimeout(
        () =>
          requestModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt.userMessage }] }],
          }),
        this.config.timeoutMs
      );
    } catch (err) {
      throw this.classifyError(err);
    }

    const latencyMs = Date.now() - startMs;
    const response = rawResult.response;

    // Validate the response has usable content before adapting
    this.assertUsableResponse(response);

    const providerResponse = this.adapter.adaptGenerateContentResponse(
      response,
      this.config.model,
      latencyMs,
      rawResult
    );

    // Final guard: empty content after safety checks is a non-retryable failure
    if (providerResponse.content.trim().length === 0) {
      throw new ProviderUnavailableError(
        PROVIDER_NAMES.GEMINI,
        'Response content is empty — the request may have been blocked by safety filters',
        { retryable: false }
      );
    }

    return providerResponse;
  }

  /**
   * Classifies any thrown value from the Gemini SDK into a typed ProviderError.
   * Called from the catch block in executeComplete() before re-throwing.
   *
   * Maps:
   *  - GoogleGenerativeAIFetchError(429) → ProviderRateLimitError
   *  - GoogleGenerativeAIFetchError(401/403) → ProviderAuthError
   *  - GoogleGenerativeAIFetchError(422) → ProviderContextOverflowError
   *  - GoogleGenerativeAIFetchError(other) → ProviderUnavailableError with status
   *  - GoogleGenerativeAIAbortError → delegated to BaseProvider.normalizeError()
   *    (which maps AbortError → ProviderTimeoutError)
   *  - GoogleGenerativeAIResponseError → ProviderUnavailableError (safety / parse)
   *  - Everything else → BaseProvider.normalizeError()
   */
  private classifyError(err: unknown): Error {
    if (err instanceof GoogleGenerativeAIFetchError) {
      const status = err.status;

      if (status === 429) {
        // Extract Retry-After if present in the error details
        const retryAfterMs = this.extractRetryAfterMs(err);
        return new ProviderRateLimitError(PROVIDER_NAMES.GEMINI, {
          retryAfterMs,
          cause: err,
        });
      }

      if (status === 401 || status === 403) {
        return new ProviderAuthError(PROVIDER_NAMES.GEMINI, { cause: err });
      }

      if (status === 422) {
        // 422 from Gemini typically means the context window was exceeded
        return new ProviderContextOverflowError(
          PROVIDER_NAMES.GEMINI,
          0, // We don't have exact counts at this point
          this.config.maxTokens,
          { cause: err }
        );
      }

      return new ProviderUnavailableError(
        PROVIDER_NAMES.GEMINI,
        err.message,
        { retryable: this.isRetryableStatus(status), statusCode: status ?? null, cause: err }
      );
    }

    if (err instanceof GoogleGenerativeAIAbortError) {
      // BaseProvider.normalizeError() handles AbortError → ProviderTimeoutError
      return this.normalizeError(err);
    }

    if (err instanceof GoogleGenerativeAIResponseError) {
      // Safety block, parse error, or empty response
      return new ProviderUnavailableError(
        PROVIDER_NAMES.GEMINI,
        `Model response error: ${err.message}`,
        { retryable: false, cause: err }
      );
    }

    // Delegate all other errors (network, AbortError, unknown) to BaseProvider
    return this.normalizeError(err);
  }

  /**
   * Asserts that the SDK response has at least one candidate with content.
   * Throws ProviderUnavailableError if the response was fully blocked.
   */
  private assertUsableResponse(
    response: Awaited<ReturnType<typeof this.model.generateContent>>['response']
  ): void {
    const candidates = response.candidates ?? [];

    if (candidates.length === 0) {
      const blockReason = response.promptFeedback?.blockReason;
      throw new ProviderUnavailableError(
        PROVIDER_NAMES.GEMINI,
        blockReason
          ? `Prompt blocked by safety filters: ${blockReason}`
          : 'No candidates returned in response',
        { retryable: false }
      );
    }
  }

  /**
   * Attempts to extract a Retry-After value from the SDK error's errorDetails.
   * Gemini may include retry information in the error payload.
   * Returns null if not present or unparseable.
   */
  private extractRetryAfterMs(err: GoogleGenerativeAIFetchError): number | null {
    try {
      const details = err.errorDetails;
      if (!Array.isArray(details)) return null;

      for (const detail of details) {
        // Google API error details use '@type' to identify the message type
        if (
          detail != null &&
          typeof detail === 'object' &&
          typeof (detail as Record<string, unknown>)['retryDelay'] === 'string'
        ) {
          const delayStr = (detail as Record<string, unknown>)['retryDelay'] as string;
          // Delay is in format "Xs" (seconds)
          const seconds = parseFloat(delayStr.replace('s', ''));
          if (!isNaN(seconds)) {
            return Math.ceil(seconds * 1000);
          }
        }
      }
    } catch {
      // Parsing failed — return null and let the caller handle backoff
    }

    return null;
  }

  /**
   * Determines whether an HTTP status code warrants a retry.
   * 5xx are transient server errors; 4xx (except 429) are client errors.
   */
  private isRetryableStatus(status: number | undefined): boolean {
    if (status === undefined) return true;
    return status >= 500 && status < 600;
  }
}
