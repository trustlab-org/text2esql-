import { buildMetricsReport, registerMetricsRoutes } from './metrics.routes';
import type { MetricsSummary } from '../services/observability';
import type { MetricsReport } from './metrics.routes';

function summary(over: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    totalRequests: 10,
    cacheHits: 4,
    cacheMisses: 6,
    fallbackCount: 1,
    validationFailures: 2,
    correctionAttempts: 3,
    avgLatencyMs: 120,
    providerCallCounts: {
      openai: { total: 5, failures: 0, totalTokens: 100, totalLatencyMs: 500 },
      gemini: { total: 1, failures: 0, totalTokens: 20, totalLatencyMs: 80 },
      groq: { total: 0, failures: 0, totalTokens: 0, totalLatencyMs: 0 },
      ollama: { total: 0, failures: 0, totalTokens: 0, totalLatencyMs: 0 },
      anthropic: { total: 0, failures: 0, totalTokens: 0, totalLatencyMs: 0 },
    } as MetricsSummary['providerCallCounts'],
    uptimeMs: 1000,
    snapshotAt: '2024-01-01T00:00:00.000Z',
    estimatedTotalCostUsd: 0.05,
    ...over,
  };
}

describe('buildMetricsReport', () => {
  it('derives rates from the raw summary counters', () => {
    const r: MetricsReport = buildMetricsReport(summary());

    expect(r.totalRequests).toBe(10);
    expect(r.cacheHitRate).toBe(40);
    expect(r.avgPipelineLatencyMs).toBe(120);
    expect(r.providerUsageCounts.openai).toBe(5);
    expect(r.providerUsageCounts.gemini).toBe(1);
    expect(r.fallbackRate).toBe(10);
    expect(r.validationPassRate).toBe(80);
    expect(r.correctionAttemptRate).toBe(30);
    expect(r.estimatedTotalCostUsd).toBe(0.05);
  });

  it('returns zero rates when there is no data', () => {
    const r = buildMetricsReport(
      summary({
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        fallbackCount: 0,
        validationFailures: 0,
        correctionAttempts: 0,
        avgLatencyMs: 0,
        estimatedTotalCostUsd: 0,
      })
    );

    expect(r.totalRequests).toBe(0);
    expect(r.cacheHitRate).toBe(0);
    expect(r.fallbackRate).toBe(0);
    expect(r.validationPassRate).toBe(0);
    expect(r.correctionAttemptRate).toBe(0);
  });
});

describe('registerMetricsRoutes', () => {
  it('registers a GET handler that returns the derived report', async () => {
    let handler: any;
    const router = {
      get: jest.fn((_opts: unknown, h: unknown) => {
        handler = h;
      }),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as import('@kbn/core/server').IRouter;
    const context = {
      metrics: { getMetrics: jest.fn().mockReturnValue(summary()) },
      logger: { logRequest: jest.fn() },
    } as unknown as import('../types').QueryCopilotContext;

    registerMetricsRoutes(router, context);

    const response = { ok: jest.fn((x) => x) };
    const request = { headers: {}, url: { pathname: '/api/query_copilot/metrics' } };
    await handler({}, request, response);

    expect(response.ok).toHaveBeenCalledWith({
      body: expect.objectContaining({ totalRequests: 10, cacheHitRate: 40 }),
    });
    expect(context.metrics.getMetrics).toHaveBeenCalled();
  });
});
