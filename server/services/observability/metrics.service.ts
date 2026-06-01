import type { ProviderName } from '../../../common';
import { PROVIDER_NAMES } from '../../../common';
import type { ObservabilityEvent } from '../../../common/types';

// ---------------------------------------------------------------------------
// MetricsSummary — the typed snapshot returned by getMetrics()
// ---------------------------------------------------------------------------

export interface ProviderCallMetrics {
  readonly total: number;
  readonly failures: number;
  readonly totalTokens: number;
  readonly totalLatencyMs: number;
}

export interface MetricsSummary {
  readonly totalRequests: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
  readonly fallbackCount: number;
  readonly validationFailures: number;
  readonly correctionAttempts: number;
  readonly avgLatencyMs: number;
  readonly estimatedTotalCostUsd: number;
  readonly providerCallCounts: Readonly<Record<ProviderName, ProviderCallMetrics>>;
  readonly uptimeMs: number;
  readonly snapshotAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Internal mutable counters — never exposed directly
// ---------------------------------------------------------------------------

interface MutableProviderMetrics {
  total: number;
  failures: number;
  totalTokens: number;
  totalLatencyMs: number;
}

function emptyProviderMetrics(): MutableProviderMetrics {
  return { total: 0, failures: 0, totalTokens: 0, totalLatencyMs: 0 };
}

function initialProviderMap(): Record<ProviderName, MutableProviderMetrics> {
  return {
    [PROVIDER_NAMES.GEMINI]: emptyProviderMetrics(),
    [PROVIDER_NAMES.GROQ]: emptyProviderMetrics(),
    [PROVIDER_NAMES.OLLAMA]: emptyProviderMetrics(),
    [PROVIDER_NAMES.ANTHROPIC]: emptyProviderMetrics(),
    [PROVIDER_NAMES.OPENAI]: emptyProviderMetrics(),
  };
}

// ---------------------------------------------------------------------------
// MetricsService
// ---------------------------------------------------------------------------

/**
 * In-memory metrics collector for the queryCopilot pipeline.
 *
 * Design:
 *  - All counters are plain numbers — no external dependencies.
 *  - recordEvent() is the single ingestion point; it dispatches on payload.kind.
 *  - getMetrics() returns a deep-frozen snapshot — callers cannot mutate state.
 *  - avgLatencyMs is a running mean updated incrementally (no stored history).
 *  - Extensible to Elastic APM: replace the increment methods with APM span
 *    recordings without changing the public interface.
 *
 * Thread safety: Node.js is single-threaded; no locking needed.
 */
export class MetricsService {
  private readonly startedAt: number = Date.now();

  // ── Counters ──────────────────────────────────────────────────────────────
  private totalRequests = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private fallbackCount = 0;
  private validationFailures = 0;
  private correctionAttempts = 0;

  // Running mean state
  private totalCompletedRequests = 0;
  private totalLatencyMs = 0;

  // Accumulated estimated cost across completed runs
  private totalCostUsd = 0;

  // Per-provider breakdown
  private readonly providerMetrics: Record<ProviderName, MutableProviderMetrics> =
    initialProviderMap();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Ingest an ObservabilityEvent and increment the appropriate counters.
   * Unknown payload kinds are silently ignored — forward compatibility.
   */
  public recordEvent(event: ObservabilityEvent): void {
    const { payload } = event;

    switch (payload.kind) {
      case 'pipeline_start':
        this.totalRequests += 1;
        break;

      case 'pipeline_complete':
        if (payload.totalDurationMs !== undefined) {
          this.totalCompletedRequests += 1;
          this.totalLatencyMs += payload.totalDurationMs;
        }
        if (typeof payload.costUsd === 'number') {
          this.totalCostUsd += payload.costUsd;
        }
        break;

      case 'cache_hit':
        this.cacheHits += 1;
        break;

      case 'cache_miss':
        this.cacheMisses += 1;
        break;

      case 'provider_response':
        this.incrementProviderSuccess(
          payload.provider,
          payload.latencyMs,
          payload.promptTokens + payload.completionTokens
        );
        break;

      case 'provider_error':
        this.incrementProviderFailure(payload.provider);
        if (payload.retryable) {
          this.fallbackCount += 1;
        }
        break;

      case 'query_validated':
        if (!payload.isValid) {
          this.validationFailures += 1;
        }
        break;

      case 'query_corrected':
        this.correctionAttempts += 1;
        break;

      // These event kinds don't map to a counter — no-op
      case 'query_generated':
      case 'query_failed':
      case 'provider_request':
      case 'intent_classified':
      case 'pipeline_abort':
        break;

      default: {
        // Exhaustiveness guard — payload.kind is a discriminated union.
        // If a new kind is added to ObservabilityEventPayload without updating
        // this switch, TypeScript will flag it here.
        const _exhaustive: never = payload;
        void _exhaustive;
        break;
      }
    }
  }

  /**
   * Returns a deep-frozen snapshot of current metrics.
   * Safe to serialize and expose via the /health endpoint.
   */
  public getMetrics(): MetricsSummary {
    const avgLatencyMs =
      this.totalCompletedRequests > 0
        ? Math.round(this.totalLatencyMs / this.totalCompletedRequests)
        : 0;

    const providerCallCounts = Object.fromEntries(
      Object.entries(this.providerMetrics).map(([provider, m]) => [
        provider,
        Object.freeze<ProviderCallMetrics>({
          total: m.total,
          failures: m.failures,
          totalTokens: m.totalTokens,
          totalLatencyMs: m.totalLatencyMs,
        }),
      ])
    ) as Record<ProviderName, ProviderCallMetrics>;

    return Object.freeze<MetricsSummary>({
      totalRequests: this.totalRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      fallbackCount: this.fallbackCount,
      validationFailures: this.validationFailures,
      correctionAttempts: this.correctionAttempts,
      avgLatencyMs,
      estimatedTotalCostUsd: Math.round(this.totalCostUsd * 1e6) / 1e6,
      providerCallCounts: Object.freeze(providerCallCounts),
      uptimeMs: Date.now() - this.startedAt,
      snapshotAt: new Date().toISOString(),
    });
  }

  /**
   * Resets all counters to zero. Intended for testing only.
   * Not exposed on the plugin context — call sites must hold the instance.
   */
  public reset(): void {
    this.totalRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.fallbackCount = 0;
    this.validationFailures = 0;
    this.correctionAttempts = 0;
    this.totalCompletedRequests = 0;
    this.totalLatencyMs = 0;
    this.totalCostUsd = 0;

    for (const key of Object.keys(this.providerMetrics) as ProviderName[]) {
      this.providerMetrics[key] = emptyProviderMetrics();
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private incrementProviderSuccess(
    provider: ProviderName,
    latencyMs: number,
    tokens: number
  ): void {
    const m = this.providerMetrics[provider];
    m.total += 1;
    m.totalLatencyMs += latencyMs;
    m.totalTokens += tokens;
  }

  private incrementProviderFailure(provider: ProviderName): void {
    const m = this.providerMetrics[provider];
    m.total += 1;
    m.failures += 1;
  }
}
