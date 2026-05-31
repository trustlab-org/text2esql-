import type { ProviderName } from '../../../common';
import type { ILLMProvider, ProviderPrompt, ProviderResponse, ProviderMetadata } from './types';
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  ProviderAuthError,
} from './errors';

// ---------------------------------------------------------------------------
// Retry state — private to BaseProvider, not exposed to subclasses
// ---------------------------------------------------------------------------

interface RetryState {
  attempt: number;
  lastError: unknown;
}

// ---------------------------------------------------------------------------
// HTTP status → error class mapping
// Used by normalizeError() to classify upstream HTTP errors consistently
// across all provider adapters.
// ---------------------------------------------------------------------------

const HTTP_STATUS_MAP: ReadonlyArray<{
  status: number;
  factory: (provider: ProviderName, cause: unknown) => ProviderError;
}> = [
  {
    status: 401,
    factory: (p, c) => new ProviderAuthError(p, { cause: c }),
  },
  {
    status: 403,
    factory: (p, c) => new ProviderAuthError(p, { cause: c }),
  },
  {
    status: 429,
    factory: (p, c) => new ProviderRateLimitError(p, { cause: c }),
  },
  {
    status: 503,
    factory: (p, c) => new ProviderUnavailableError(p, 'service unavailable', { cause: c }),
  },
  {
    status: 504,
    factory: (p, c) =>
      new ProviderTimeoutError(p, 0, { cause: c }),
  },
];

// ---------------------------------------------------------------------------
// BaseProvider
//
// Abstract base that every concrete provider adapter extends.
//
// Concrete adapters implement:
//   complete()        — send the prompt, return a ProviderResponse
//   isHealthy()       — lightweight reachability probe
//   getMetadata()     — static descriptor (name, role, priority, maxTokens)
//   estimateTokens()  — pre-flight token estimate
//
// Infrastructure methods provided here:
//   retry()           — exponential backoff with jitter
//   withTimeout()     — Promise race against a deadline
//   normalizeError()  — classifies any thrown value into a ProviderError
//
// Concrete adapters should call normalizeError() in their catch blocks and
// re-throw the result so the router sees typed errors, not raw fetch failures.
// ---------------------------------------------------------------------------

export abstract class BaseProvider implements ILLMProvider {
  // ── Abstract — concrete adapters must implement ───────────────────────────

  abstract complete(prompt: ProviderPrompt): Promise<ProviderResponse>;
  abstract isHealthy(): Promise<boolean>;
  abstract getMetadata(): ProviderMetadata;

  /**
   * Cheap pre-flight token estimate.
   * Concrete adapters should override this with a tokeniser appropriate to
   * their model family. The default heuristic (chars / 4) is sufficient for
   * context-window guards where exact counts are not required.
   */
  estimateTokens(text: string): number {
    // GPT-family heuristic: ~4 chars per token on average.
    // Overriding with a BPE tokeniser improves accuracy at the cost of
    // a synchronous CPU budget — acceptable for most use cases.
    return Math.ceil(text.length / 4);
  }

  // ── Protected infrastructure ──────────────────────────────────────────────

  /**
   * Retry a fallible async operation with exponential backoff and full jitter.
   *
   * Behaviour:
   *  - Attempt 0 runs immediately (no delay before the first try).
   *  - On failure, checks `retryable` if the error is a ProviderError;
   *    non-retryable errors are re-thrown immediately without further attempts.
   *  - Delay between attempt N and N+1: baseDelayMs * 2^N + jitter (0–baseDelayMs).
   *  - maxRetries = 0 means try once and do not retry on failure.
   *  - After all attempts are exhausted, the last caught error is re-thrown.
   *
   * @param fn         The operation to attempt.
   * @param maxRetries Maximum number of retries (total attempts = maxRetries + 1).
   * @param baseDelayMs Base delay in milliseconds before exponential scaling.
   */
  protected async retry<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    baseDelayMs: number
  ): Promise<T> {
    const state: RetryState = { attempt: 0, lastError: undefined };

    while (state.attempt <= maxRetries) {
      try {
        return await fn();
      } catch (err) {
        state.lastError = err;

        // Non-retryable ProviderErrors abort immediately — no point sleeping
        if (err instanceof ProviderError && !err.retryable) {
          throw err;
        }

        if (state.attempt >= maxRetries) {
          break;
        }

        const exponentialMs = baseDelayMs * Math.pow(2, state.attempt);
        const jitterMs = Math.random() * baseDelayMs;
        const delayMs = exponentialMs + jitterMs;

        await sleep(delayMs);
        state.attempt += 1;
      }
    }

    throw state.lastError;
  }

  /**
   * Race a Promise against a timeout deadline.
   *
   * Throws ProviderTimeoutError if `fn` does not resolve within `timeoutMs`.
   * The underlying operation is not cancelled (Promise cancellation is not
   * supported in JS) but the rejection is surfaced to the caller immediately.
   *
   * @param fn        The async operation to time-box.
   * @param timeoutMs Deadline in milliseconds.
   */
  protected async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    const provider = this.getMetadata().name;

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new ProviderTimeoutError(provider, timeoutMs));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([fn(), timeoutPromise]);
      return result;
    } finally {
      // Always clear the timer so Node doesn't stay alive waiting for it
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Classify any thrown value into a typed ProviderError.
   *
   * Concrete adapters call this in their catch blocks:
   *
   *   } catch (err) {
   *     throw this.normalizeError(err);
   *   }
   *
   * Handles:
   *  - Already-typed ProviderError instances   → returned as-is
   *  - Objects with a numeric `status` field   → mapped via HTTP_STATUS_MAP
   *  - AbortError / timeout signals            → ProviderTimeoutError
   *  - Everything else                         → ProviderUnavailableError
   */
  protected normalizeError(error: unknown): ProviderError {
    const provider = this.getMetadata().name;

    // Already typed — pass through unchanged
    if (error instanceof ProviderError) {
      return error;
    }

    // Timeout signals from fetch AbortController or native timeout
    if (isAbortError(error)) {
      return new ProviderTimeoutError(provider, 0, { cause: error });
    }

    // HTTP error objects (node-fetch, axios, undici, custom fetch wrappers)
    const httpStatus = extractHttpStatus(error);
    if (httpStatus !== null) {
      for (const mapping of HTTP_STATUS_MAP) {
        if (mapping.status === httpStatus) {
          return mapping.factory(provider, error);
        }
      }

      // Unmapped HTTP error — treat as unavailable with the raw status
      return new ProviderUnavailableError(
        provider,
        `HTTP ${httpStatus}`,
        { statusCode: httpStatus, cause: error }
      );
    }

    // Network / DNS / connection refused
    if (isNetworkError(error)) {
      return new ProviderUnavailableError(
        provider,
        errorMessage(error),
        { retryable: true, cause: error }
      );
    }

    // Unknown — wrap as generic ProviderError, not retryable by default
    return new ProviderUnavailableError(
      provider,
      errorMessage(error),
      { retryable: false, cause: error }
    );
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      error.message.toLowerCase().includes('aborted')
    );
  }
  return false;
}

/**
 * Extracts a numeric HTTP status from any error-like object.
 * Covers: { status }, { statusCode }, { response: { status } }
 */
function extractHttpStatus(error: unknown): number | null {
  if (error == null || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;

  if (typeof e.status === 'number') return e.status;
  if (typeof e.statusCode === 'number') return e.statusCode;

  if (e.response != null && typeof e.response === 'object') {
    const r = e.response as Record<string, unknown>;
    if (typeof r.status === 'number') return r.status;
  }

  return null;
}

/**
 * Heuristic classification of network-layer errors.
 * Covers ECONNREFUSED, ENOTFOUND, ECONNRESET, etc.
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code ?? '';
  return (
    code.startsWith('ECONN') ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EPIPE' ||
    code === 'EHOSTUNREACH'
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
