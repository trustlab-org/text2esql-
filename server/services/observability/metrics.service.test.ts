import type { ObservabilityEvent, PipelineEventPayload } from '../../../common/types';
import { MetricsService } from './metrics.service';

/**
 * Builds a minimal, valid ObservabilityEvent for a pipeline_complete event
 * carrying the given payload. Mirrors the ObservabilityEvent shape so the
 * service's discriminated-union dispatch works as in production.
 */
function pipelineCompleteEvent(payload: PipelineEventPayload): ObservabilityEvent {
  return {
    eventId: 'evt-1',
    type: 'pipeline_complete',
    pipelineId: 'pipe-1',
    sessionId: 'sess-1',
    timestamp: new Date().toISOString(),
    durationMs: payload.totalDurationMs ?? null,
    severity: 'info',
    provider: null,
    stage: null,
    payload,
    tags: [],
  };
}

describe('MetricsService — estimatedTotalCostUsd', () => {
  it('accumulates costUsd from pipeline_complete events', () => {
    const service = new MetricsService();

    service.recordEvent(
      pipelineCompleteEvent({ kind: 'pipeline_complete', totalDurationMs: 10, costUsd: 0.0025 })
    );
    service.recordEvent(
      pipelineCompleteEvent({ kind: 'pipeline_complete', totalDurationMs: 10, costUsd: 0.001 })
    );

    expect(service.getMetrics().estimatedTotalCostUsd).toBeCloseTo(0.0035, 6);
  });

  it('treats missing costUsd as zero contribution', () => {
    const service = new MetricsService();

    service.recordEvent(
      pipelineCompleteEvent({ kind: 'pipeline_complete', totalDurationMs: 10 })
    );

    expect(service.getMetrics().estimatedTotalCostUsd).toBe(0);
  });

  it('resets estimatedTotalCostUsd to 0', () => {
    const service = new MetricsService();

    service.recordEvent(
      pipelineCompleteEvent({ kind: 'pipeline_complete', totalDurationMs: 10, costUsd: 0.0025 })
    );
    expect(service.getMetrics().estimatedTotalCostUsd).toBeGreaterThan(0);

    service.reset();

    expect(service.getMetrics().estimatedTotalCostUsd).toBe(0);
  });
});
