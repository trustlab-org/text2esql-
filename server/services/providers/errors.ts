import type { ProviderName } from '../../../common';

// ---------------------------------------------------------------------------
// ProviderError — base class
//
// All provider failures are instances of ProviderError or a subclass.
// Callers can catch ProviderError to handle any provider failure generically,
// or narrow to a specific subclass for retry/fallback decisions.
//
// Design:
//  - `provider` identifies which adapter threw — essential for observability
//    when multiple providers are in play.
//  - `retryable` drives retry and fallback logic in BaseProvider and the router
//    without requiring instanceof checks on specific subclasses.
//  - `statusCode` carries the upstream HTTP status when available, enabling
//    mapping to Kibana response codes in route handlers.
//  - `cause` preserves the original error for stack traces and debug logging.
// ---------------------------------------------------------------------------

export class ProviderError extends Error {
  public readonly provider: ProviderName;
  public readonly retryable: boolean;
  public readonly statusCode: number | null;
  public readonly cause: unknown;

  constructor(
    message: string,
    provider: ProviderName,
    options: {
      retryable?: boolean;
      statusCode?: number | null;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? null;
    this.cause = options.cause;

    // Maintain correct prototype chain for instanceof checks across
    // transpilation boundaries (required when targeting ES5).
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// ProviderRateLimitError
//
// Thrown when the upstream API returns HTTP 429 or an equivalent signal.
// Always retryable — callers should back off and retry or fall back.
// `retryAfterMs` carries the Retry-After header value when present.
// ---------------------------------------------------------------------------

export class ProviderRateLimitError extends ProviderError {
  public readonly retryAfterMs: number | null;

  constructor(
    provider: ProviderName,
    options: {
      retryAfterMs?: number | null;
      cause?: unknown;
    } = {}
  ) {
    super(
      `Provider "${provider}" is rate limited. ` +
        (options.retryAfterMs != null
          ? `Retry after ${options.retryAfterMs}ms.`
          : 'No retry-after header provided.'),
      provider,
      { retryable: true, statusCode: 429, cause: options.cause }
    );
    this.name = 'ProviderRateLimitError';
    this.retryAfterMs = options.retryAfterMs ?? null;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// ProviderTimeoutError
//
// Thrown when a request exceeds the configured timeout budget.
// Retryable — a transient network condition may have caused the timeout.
// `timeoutMs` records the budget that was exceeded for observability.
// ---------------------------------------------------------------------------

export class ProviderTimeoutError extends ProviderError {
  public readonly timeoutMs: number;

  constructor(
    provider: ProviderName,
    timeoutMs: number,
    options: { cause?: unknown } = {}
  ) {
    super(
      `Provider "${provider}" timed out after ${timeoutMs}ms.`,
      provider,
      { retryable: true, statusCode: 504, cause: options.cause }
    );
    this.name = 'ProviderTimeoutError';
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// ProviderUnavailableError
//
// Thrown when the provider is unreachable (network error, 503, DNS failure)
// or explicitly disabled in configuration.
// Retryable for transient network failures; non-retryable for config issues.
// ---------------------------------------------------------------------------

export class ProviderUnavailableError extends ProviderError {
  constructor(
    provider: ProviderName,
    reason: string,
    options: {
      retryable?: boolean;
      statusCode?: number | null;
      cause?: unknown;
    } = {}
  ) {
    super(
      `Provider "${provider}" is unavailable: ${reason}`,
      provider,
      {
        retryable: options.retryable ?? true,
        statusCode: options.statusCode ?? 503,
        cause: options.cause,
      }
    );
    this.name = 'ProviderUnavailableError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// ProviderAuthError
//
// Thrown when the upstream API rejects the API key (HTTP 401/403).
// Never retryable — a bad key won't become valid on retry.
// ---------------------------------------------------------------------------

export class ProviderAuthError extends ProviderError {
  constructor(provider: ProviderName, options: { cause?: unknown } = {}) {
    super(
      `Provider "${provider}" rejected authentication. Check the API key in kibana.yml.`,
      provider,
      { retryable: false, statusCode: 401, cause: options.cause }
    );
    this.name = 'ProviderAuthError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// ProviderContextOverflowError
//
// Thrown when the combined prompt + completion exceeds the model's context
// window. Not retryable with the same input — the caller must reduce context.
// ---------------------------------------------------------------------------

export class ProviderContextOverflowError extends ProviderError {
  public readonly estimatedTokens: number;
  public readonly maxTokens: number;

  constructor(
    provider: ProviderName,
    estimatedTokens: number,
    maxTokens: number,
    options: { cause?: unknown } = {}
  ) {
    super(
      `Provider "${provider}" context overflow: estimated ${estimatedTokens} tokens exceeds limit of ${maxTokens}.`,
      provider,
      { retryable: false, statusCode: 422, cause: options.cause }
    );
    this.name = 'ProviderContextOverflowError';
    this.estimatedTokens = estimatedTokens;
    this.maxTokens = maxTokens;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// Type guard utilities
// ---------------------------------------------------------------------------

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

export function isRetryableProviderError(error: unknown): boolean {
  return isProviderError(error) && error.retryable;
}
