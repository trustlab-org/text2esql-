import type { ProviderName } from '../../../../common';
import type { ILLMProvider, ProviderPrompt, ProviderResponse } from '../types';
import {
  ProviderError,
  ProviderRateLimitError,
  ProviderUnavailableError,
  ProviderTimeoutError,
} from '../errors';
import type { LoggerService } from '../../observability';
import type { IRoutingStrategy, ProviderHealthState } from './routing.strategy';
import type { IHealthMonitor } from './health.monitor';

// ---------------------------------------------------------------------------
// ProviderRoutingState — public snapshot for health endpoints and observability
// ---------------------------------------------------------------------------

export interface ProviderRoutingState {
  readonly activeProvider: ProviderName | null;
  readonly providers: ReadonlyArray<{
    readonly name: ProviderName;
    readonly healthy: boolean;
    readonly lastCheckedAt: string | null;
    readonly consecutiveFailures: number;
    readonly role: string;
    readonly priority: number;
  }>;
}

// ---------------------------------------------------------------------------
// RouteAttempt — internal record for a single routing attempt
// ---------------------------------------------------------------------------

interface RouteAttempt {
  readonly provider: ProviderName;
  readonly error: ProviderError;
}

// ---------------------------------------------------------------------------
// ProviderRouter
//
// Responsibilities:
//  - Accept a prompt and return a ProviderResponse from the best available provider.
//  - Honour preferredProvider when set and healthy.
//  - Fall back through the strategy-ordered chain on retryable failures.
//  - Skip unhealthy providers (but attempt them last if all healthy ones fail).
//  - Track per-request latency across routing attempts.
//  - Trigger a background health re-check when a provider fails mid-request.
//  - Never expose raw SDK errors to callers — always ProviderError subclasses.
//
// Fallback chain semantics:
//   Pass 1: preferred (if set + healthy) → strategy-ordered healthy providers
//   Pass 2: strategy-ordered unhealthy providers (last-resort)
//   If all fail: throw ProviderError with exhausted message + attempt log
//
// Errors that trigger fallback:
//   ProviderRateLimitError   — provider is busy, try next
//   ProviderUnavailableError — provider is down, try next
//   ProviderTimeoutError     — transient, try next
//
// Errors that abort immediately (no fallback):
//   ProviderAuthError            — misconfiguration, operator action required
//   ProviderContextOverflowError — prompt too large, caller must reduce input
// ---------------------------------------------------------------------------

export class ProviderRouter {
  private readonly providers: ReadonlyMap<ProviderName, ILLMProvider>;
  private readonly healthMonitor: IHealthMonitor;
  private readonly strategy: IRoutingStrategy;
  private readonly logger: LoggerService;

  // Tracks the last successfully used provider name for getCurrentRouteState()
  private lastActiveProvider: ProviderName | null = null;

  constructor(
    providers: ReadonlyMap<ProviderName, ILLMProvider>,
    healthMonitor: IHealthMonitor,
    strategy: IRoutingStrategy,
    logger: LoggerService
  ) {
    this.providers = providers;
    this.healthMonitor = healthMonitor;
    this.strategy = strategy;
    this.logger = logger;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Route a prompt to the best available provider and return a response.
   *
   * @param prompt            The normalised prompt to complete.
   * @param requestId         Correlation ID for structured logging.
   * @param preferredProvider Optional pinned provider — used if healthy.
   */
  public async route(
    prompt: ProviderPrompt,
    requestId: string,
    preferredProvider?: ProviderName
  ): Promise<ProviderResponse> {
    const healthStates = this.healthMonitor.getHealthStates();
    const chain = this.buildChain(preferredProvider, healthStates);

    if (chain.length === 0) {
      throw new ProviderError(
        'No providers are registered. Check plugin configuration.',
        'openai' as ProviderName, // placeholder name — no providers available
        { retryable: false }
      );
    }

    const attempts: RouteAttempt[] = [];

    for (const providerName of chain) {
      const provider = this.providers.get(providerName);
      if (!provider) continue;

      try {
        this.logger.logPipelineStage(requestId, 'provider_route_attempt', 0, {
          provider: providerName,
          attemptNumber: attempts.length + 1,
          chainLength: chain.length,
        });

        const startMs = Date.now();
        const response = await provider.complete(prompt);
        const latencyMs = Date.now() - startMs;

        this.lastActiveProvider = providerName;

        this.logger.logProviderCall(requestId, providerName, latencyMs, response.tokensUsed.totalTokens, true);

        return response;
      } catch (err) {
        const providerError = this.ensureProviderError(err, providerName);

        this.logger.logProviderCall(requestId, providerName, 0, 0, false);
        this.logger.logError(requestId, providerError, {
          provider: providerName,
          attemptNumber: attempts.length + 1,
          fallbackable: this.isFallbackable(providerError),
        });

        attempts.push({ provider: providerName, error: providerError });

        // Trigger background health re-check — don't await, fire-and-forget
        void this.healthMonitor.checkProvider(providerName);

        // Non-fallbackable errors abort the chain immediately
        if (!this.isFallbackable(providerError)) {
          throw providerError;
        }

        // Continue to next provider in chain
      }
    }

    // All providers exhausted
    throw this.buildExhaustedError(attempts);
  }

  /**
   * Returns a snapshot of current routing state.
   * Safe to call at any time — used by the /health endpoint.
   */
  public getCurrentRouteState(): ProviderRoutingState {
    const healthStates = this.healthMonitor.getHealthStates();

    const providerDetails = Array.from(this.providers.entries()).map(([name, provider]) => {
      const meta = provider.getMetadata();
      const health = healthStates.get(name);
      return {
        name,
        healthy: health?.healthy ?? true,
        lastCheckedAt: health?.lastCheckedAt ?? null,
        consecutiveFailures: health?.consecutiveFailures ?? 0,
        role: meta.role,
        priority: meta.priority,
      };
    });

    // Sort by role tier then priority for a stable display order
    providerDetails.sort((a, b) => {
      const roleTierA = ROLE_TIER[a.role] ?? 99;
      const roleTierB = ROLE_TIER[b.role] ?? 99;
      if (roleTierA !== roleTierB) return roleTierA - roleTierB;
      return a.priority - b.priority;
    });

    return Object.freeze<ProviderRoutingState>({
      activeProvider: this.lastActiveProvider,
      providers: Object.freeze(providerDetails),
    });
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Builds the ordered fallback chain for this request.
   *
   * Chain construction:
   *  1. If preferredProvider is set and healthy → prepend it, deduplicate rest
   *  2. Strategy-ordered healthy providers
   *  3. Strategy-ordered unhealthy providers (last resort)
   *
   * The preferred provider is only prepended when healthy; if unhealthy it
   * falls into its natural position in the last-resort tier.
   */
  private buildChain(
    preferredProvider: ProviderName | undefined,
    healthStates: ReadonlyMap<ProviderName, ProviderHealthState>
  ): ProviderName[] {
    const ordered = this.strategy.order(this.providers, healthStates);

    // Split into healthy and unhealthy tiers
    const healthy: ProviderName[] = [];
    const unhealthy: ProviderName[] = [];

    for (const name of ordered) {
      const state = healthStates.get(name);
      const isHealthy = state?.healthy ?? true; // optimistic if unchecked
      if (isHealthy) {
        healthy.push(name);
      } else {
        unhealthy.push(name);
      }
    }

    // Build the primary chain: preferred (if healthy) first, then remaining healthy
    const chain: ProviderName[] = [];
    const seen = new Set<ProviderName>();

    if (preferredProvider) {
      const preferredState = healthStates.get(preferredProvider);
      const preferredHealthy = preferredState?.healthy ?? true;

      if (preferredHealthy && this.providers.has(preferredProvider)) {
        chain.push(preferredProvider);
        seen.add(preferredProvider);
      }
    }

    for (const name of healthy) {
      if (!seen.has(name)) {
        chain.push(name);
        seen.add(name);
      }
    }

    // Append unhealthy tier as last resort
    for (const name of unhealthy) {
      if (!seen.has(name)) {
        chain.push(name);
        seen.add(name);
      }
    }

    return chain;
  }

  /**
   * Determines if a ProviderError should trigger a fallback to the next provider.
   *
   * Fallback on:  RateLimitError, UnavailableError, TimeoutError (all retryable by nature)
   * Abort on:     AuthError (config issue), ContextOverflowError (input issue)
   */
  private isFallbackable(error: ProviderError): boolean {
    return (
      error instanceof ProviderRateLimitError ||
      error instanceof ProviderUnavailableError ||
      error instanceof ProviderTimeoutError
    );
  }

  /**
   * Wraps any unknown thrown value in a ProviderError.
   * Should rarely be needed — providers must throw ProviderError subclasses —
   * but defends against programming errors in adapters.
   */
  private ensureProviderError(err: unknown, provider: ProviderName): ProviderError {
    if (err instanceof ProviderError) return err;
    return new ProviderUnavailableError(
      provider,
      err instanceof Error ? err.message : String(err),
      { retryable: false, cause: err }
    );
  }

  /**
   * Builds the terminal error thrown when the entire chain is exhausted.
   * Includes a summary of every attempt for observability.
   */
  private buildExhaustedError(attempts: RouteAttempt[]): ProviderError {
    const summary = attempts
      .map((a) => `${a.provider}: ${a.error.constructor.name}(${a.error.message})`)
      .join(' | ');

    return new ProviderUnavailableError(
      attempts[attempts.length - 1]?.provider ?? ('unknown' as ProviderName),
      `All providers exhausted after ${attempts.length} attempt(s). ${summary}`,
      { retryable: false }
    );
  }
}

// ---------------------------------------------------------------------------
// Module-private constants (mirrors PriorityRoutingStrategy — avoids import cycle)
// ---------------------------------------------------------------------------

const ROLE_TIER: Record<string, number> = {
  primary: 0,
  fallback: 1,
  local: 2,
};