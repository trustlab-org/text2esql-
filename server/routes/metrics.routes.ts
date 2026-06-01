/**
 * HTTP route exposing derived pipeline metrics.
 *
 * Provides `GET /api/query_copilot/metrics`, which returns a {@link MetricsReport}
 * derived from the raw counters tracked by the `MetricsService`. The derivation
 * logic lives in the pure {@link buildMetricsReport} function so it can be unit
 * tested without HTTP mocking.
 */
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import { PLUGIN_ROUTE_PREFIX } from '../../common';
import type { MetricsSummary } from '../services/observability';

/**
 * HTTP response shape for the metrics endpoint.
 *
 * This is a derived view over the raw {@link MetricsSummary} counters: counts
 * are turned into human-friendly rates (percentages) where appropriate, and the
 * per-provider call structure is flattened to a simple name -> count map.
 */
export interface MetricsReport {
  /** Total number of requests handled by the pipeline. */
  readonly totalRequests: number;
  /** Cache hit rate as a percentage 0–100 (cache hits / cache lookups). */
  readonly cacheHitRate: number;
  /** Average end-to-end pipeline latency in milliseconds. */
  readonly avgPipelineLatencyMs: number;
  /** Per-provider call counts, keyed by provider name. */
  readonly providerUsageCounts: Readonly<Record<string, number>>;
  /** Percentage of requests that fell back to an alternate path. */
  readonly fallbackRate: number;
  /** Percentage of requests that passed validation. */
  readonly validationPassRate: number;
  /** Percentage of requests that triggered a correction attempt. */
  readonly correctionAttemptRate: number;
  /** Estimated total spend across all providers, in USD. */
  readonly estimatedTotalCostUsd: number;
}

/**
 * Derives a {@link MetricsReport} from a raw {@link MetricsSummary}.
 *
 * Pure function: given the same summary it always returns the same report and
 * performs no I/O, which keeps it trivially unit testable.
 *
 * @param summary Raw counters captured by the metrics service.
 * @returns The derived, percentage-based metrics report.
 */
export function buildMetricsReport(summary: MetricsSummary): MetricsReport {
  /** Computes a 2-decimal percentage, returning 0 when there is no denominator. */
  const pct = (numerator: number, denominator: number): number =>
    denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : 0;

  const cacheLookups = summary.cacheHits + summary.cacheMisses;

  const providerUsageCounts: Record<string, number> = {};
  for (const [provider, m] of Object.entries(summary.providerCallCounts)) {
    providerUsageCounts[provider] = m.total;
  }

  return {
    totalRequests: summary.totalRequests,
    cacheHitRate: pct(summary.cacheHits, cacheLookups),
    avgPipelineLatencyMs: summary.avgLatencyMs,
    providerUsageCounts,
    fallbackRate: pct(summary.fallbackCount, summary.totalRequests),
    validationPassRate: pct(summary.totalRequests - summary.validationFailures, summary.totalRequests),
    correctionAttemptRate: pct(summary.correctionAttempts, summary.totalRequests),
    estimatedTotalCostUsd: summary.estimatedTotalCostUsd,
  };
}

/**
 * Registers the metrics route group with the Kibana router.
 *
 * @param router Kibana router to register the route on.
 * @param context Plugin context providing the metrics service and logger.
 */
export function registerMetricsRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/metrics`,
      validate: false,
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
      },
    },
    async (_ctx, request, response) => {
      context.logger.logRequest(
        (request.headers['x-request-id'] as string) ?? 'metrics',
        'GET',
        request.url.pathname
      );
      const report = buildMetricsReport(context.metrics.getMetrics());
      return response.ok({ body: report });
    }
  );
}
