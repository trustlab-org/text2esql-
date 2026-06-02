import { BENCHMARK_DATASET } from './benchmark.dataset';
import { INVESTIGATION_TYPES } from '../../../common';

describe('BENCHMARK_DATASET', () => {
  it('contains at least 20 cases', () => {
    expect(BENCHMARK_DATASET.length).toBeGreaterThanOrEqual(20);
  });

  it('has unique case ids', () => {
    const ids = BENCHMARK_DATASET.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('meets the per-investigation-type minimum counts', () => {
    const counts = (type: string): number =>
      BENCHMARK_DATASET.filter((c) => c.investigationType === type).length;

    expect(counts(INVESTIGATION_TYPES.BRUTE_FORCE)).toBeGreaterThanOrEqual(3);
    expect(counts(INVESTIGATION_TYPES.PRIVILEGE_ESCALATION)).toBeGreaterThanOrEqual(2);
    expect(counts(INVESTIGATION_TYPES.LATERAL_MOVEMENT)).toBeGreaterThanOrEqual(2);
    expect(counts(INVESTIGATION_TYPES.SUSPICIOUS_PROCESS)).toBeGreaterThanOrEqual(3);
    expect(counts(INVESTIGATION_TYPES.AUTH_ANOMALY)).toBeGreaterThanOrEqual(3);
    expect(counts(INVESTIGATION_TYPES.UNUSUAL_OUTBOUND)).toBeGreaterThanOrEqual(2);
    expect(counts(INVESTIGATION_TYPES.SUSPICIOUS_POWERSHELL)).toBeGreaterThanOrEqual(2);
    expect(counts(INVESTIGATION_TYPES.GENERAL)).toBeGreaterThanOrEqual(3);
  });

  it('keeps expectedKQLContains to 3-5 fields and expectedFilters to 0-3 entries', () => {
    for (const c of BENCHMARK_DATASET) {
      expect(c.expectedKQLContains.length).toBeGreaterThanOrEqual(3);
      expect(c.expectedKQLContains.length).toBeLessThanOrEqual(5);
      expect(c.expectedFilters.length).toBeLessThanOrEqual(3);
      expect(c.naturalLanguageQuery.length).toBeGreaterThan(0);
    }
  });
});
