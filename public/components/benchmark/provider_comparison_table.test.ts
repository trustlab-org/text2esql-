import type { ProviderBenchmarkResult } from '../../../common/types';
import { computeColumnBests } from './ProviderComparisonTable';

const makeResult = (
  overrides: Partial<ProviderBenchmarkResult> & Pick<ProviderBenchmarkResult, 'provider'>
): ProviderBenchmarkResult => ({
  avgLatencyMs: 100,
  p95LatencyMs: 200,
  avgTokens: 1000,
  avgCost: 0.01,
  avgQualityScore: 0.5,
  caseResults: [],
  ...overrides,
});

describe('computeColumnBests', () => {
  it('returns all null for an empty list', () => {
    expect(computeColumnBests([])).toEqual({
      latency: null,
      p95: null,
      tokens: null,
      cost: null,
      quality: null,
    });
  });

  it('picks MIN for latency/p95/tokens/cost and MAX for quality', () => {
    const providers: ProviderBenchmarkResult[] = [
      makeResult({
        provider: 'openai',
        avgLatencyMs: 300,
        p95LatencyMs: 500,
        avgTokens: 2000,
        avgCost: 0.05,
        avgQualityScore: 0.6,
      }),
      makeResult({
        provider: 'anthropic',
        avgLatencyMs: 150,
        p95LatencyMs: 250,
        avgTokens: 800,
        avgCost: 0.02,
        avgQualityScore: 0.9,
      }),
      makeResult({
        provider: 'groq',
        avgLatencyMs: 220,
        p95LatencyMs: 400,
        avgTokens: 1200,
        avgCost: 0.01,
        avgQualityScore: 0.75,
      }),
    ];

    expect(computeColumnBests(providers)).toEqual({
      latency: 150,
      p95: 250,
      tokens: 800,
      cost: 0.01,
      quality: 0.9,
    });
  });

  it('handles ties (best value shared by multiple providers)', () => {
    const providers: ProviderBenchmarkResult[] = [
      makeResult({ provider: 'openai', avgLatencyMs: 100, avgQualityScore: 0.8 }),
      makeResult({ provider: 'anthropic', avgLatencyMs: 100, avgQualityScore: 0.8 }),
    ];

    const bests = computeColumnBests(providers);
    expect(bests.latency).toBe(100);
    expect(bests.quality).toBe(0.8);
  });
});
