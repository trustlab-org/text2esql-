import { randomUUID } from 'node:crypto';
import type { InvestigationType, ProviderName } from '../../../common';
import type { QueryPipeline, QueryGenerationRequest } from '../query';
import type { LoggerService } from '../observability/logger.service';
import { BENCHMARK_DATASET, type BenchmarkCase } from './benchmark.dataset';
import { QualityScorer, type QualityScore } from './quality.scorer';

/** Outcome of running a single benchmark case through the pipeline. */
export interface CaseResult {
  caseId: string;
  investigationType: InvestigationType;
  status: string;
  generatedKQL: string;
  latencyMs: number;
  tokens: number;
  costUsd: number;
  quality: QualityScore;
  errorCode: string | null;
}

/** Aggregated results for one provider across the whole dataset. */
export interface ProviderBenchmarkResult {
  provider: ProviderName;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgTokens: number;
  avgCost: number;
  avgQualityScore: number;
  caseResults: CaseResult[];
}

/** Cross-provider summary used for at-a-glance comparison. */
export interface BenchmarkSummary {
  totalCases: number;
  totalRuns: number;
  bestProviderByQuality: ProviderName | null;
  bestProviderByLatency: ProviderName | null;
  bestProviderByCost: ProviderName | null;
  overallAvgQualityScore: number;
}

/** Full benchmark report returned by {@link BenchmarkRunner.run}. */
export interface BenchmarkReport {
  /** ISO 8601 timestamp of when the run started. */
  runAt: string;
  providers: ProviderBenchmarkResult[];
  summary: BenchmarkSummary;
}

/** Arithmetic mean; returns 0 for an empty input (divide-by-zero guard). */
export function mean(nums: readonly number[]): number {
  if (nums.length === 0) {
    return 0;
  }
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

/**
 * Percentile by nearest-rank on an ascending sort. `p` is a fraction in [0, 1].
 * Returns 0 for an empty input.
 */
export function percentile(nums: readonly number[], p: number): number {
  if (nums.length === 0) {
    return 0;
  }
  const sorted = [...nums].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

/**
 * Runs the full query-generation pipeline across every provider × benchmark
 * case, scores each result, and aggregates per-provider and cross-provider
 * statistics. Cases run sequentially per provider to avoid hammering provider
 * rate limits. The pipeline never throws, but each case is additionally wrapped
 * in try/catch so a single failure cannot abort the run.
 */
export class BenchmarkRunner {
  constructor(
    private readonly pipeline: QueryPipeline,
    private readonly scorer: QualityScorer,
    private readonly logger: LoggerService,
    private readonly dataset: readonly BenchmarkCase[] = BENCHMARK_DATASET,
    private readonly indexPattern: string = 'logs-*'
  ) {}

  public async run(providers: ProviderName[]): Promise<BenchmarkReport> {
    const runAt = new Date().toISOString();
    const providerResults: ProviderBenchmarkResult[] = [];

    for (const provider of providers) {
      const runId = randomUUID();
      const providerStart = Date.now();
      const caseResults: CaseResult[] = [];

      for (const benchmarkCase of this.dataset) {
        caseResults.push(await this.runCase(provider, benchmarkCase, runId));
      }

      const latencies = caseResults.map((r) => r.latencyMs);
      const avgQualityScore = mean(caseResults.map((r) => r.quality.overallScore));

      const providerResult: ProviderBenchmarkResult = {
        provider,
        avgLatencyMs: mean(latencies),
        p95LatencyMs: percentile(latencies, 0.95),
        avgTokens: mean(caseResults.map((r) => r.tokens)),
        avgCost: mean(caseResults.map((r) => r.costUsd)),
        avgQualityScore,
        caseResults,
      };
      providerResults.push(providerResult);

      this.logger.logPipelineStage(runId, 'benchmark_provider', Date.now() - providerStart, {
        provider,
        cases: this.dataset.length,
        avgQuality: avgQualityScore,
      });
    }

    return {
      runAt,
      providers: providerResults,
      summary: this.buildSummary(providers, providerResults),
    };
  }

  private async runCase(
    provider: ProviderName,
    benchmarkCase: BenchmarkCase,
    runId: string
  ): Promise<CaseResult> {
    try {
      const request: QueryGenerationRequest = {
        query: benchmarkCase.naturalLanguageQuery,
        indexPattern: this.indexPattern,
        sessionId: `benchmark-${provider}`,
        preferredProvider: provider,
        requestId: randomUUID(),
      };

      const result = await this.pipeline.execute(request);
      const generatedKQL = result.finalQuery?.queryString ?? '';

      return {
        caseId: benchmarkCase.id,
        investigationType: benchmarkCase.investigationType,
        status: result.status,
        generatedKQL,
        latencyMs: result.totalDurationMs,
        tokens: result.tokenEstimate.totalTokens,
        costUsd: result.costEstimate.totalCostUsd,
        quality: this.scorer.score(generatedKQL, benchmarkCase),
        errorCode: result.errorCode,
      };
    } catch (error) {
      // The pipeline is contractually non-throwing; this guards against any
      // unexpected error so one bad case cannot abort the whole run.
      this.logger.logError(runId, error, {
        stage: 'benchmark_case',
        provider,
        caseId: benchmarkCase.id,
      });
      return {
        caseId: benchmarkCase.id,
        investigationType: benchmarkCase.investigationType,
        status: 'error',
        generatedKQL: '',
        latencyMs: 0,
        tokens: 0,
        costUsd: 0,
        quality: this.scorer.score('', benchmarkCase),
        errorCode: error instanceof Error ? error.message : 'unknown_error',
      };
    }
  }

  private buildSummary(
    providers: readonly ProviderName[],
    results: readonly ProviderBenchmarkResult[]
  ): BenchmarkSummary {
    const ranked = results.filter((r) => r.caseResults.length > 0);

    return {
      totalCases: this.dataset.length,
      totalRuns: providers.length * this.dataset.length,
      bestProviderByQuality: this.bestBy(ranked, (r) => r.avgQualityScore, 'max'),
      bestProviderByLatency: this.bestBy(ranked, (r) => r.avgLatencyMs, 'min'),
      bestProviderByCost: this.bestBy(ranked, (r) => r.avgCost, 'min'),
      overallAvgQualityScore: mean(results.map((r) => r.avgQualityScore)),
    };
  }

  private bestBy(
    results: readonly ProviderBenchmarkResult[],
    metric: (r: ProviderBenchmarkResult) => number,
    direction: 'max' | 'min'
  ): ProviderName | null {
    if (results.length === 0) {
      return null;
    }
    let best = results[0];
    for (const candidate of results.slice(1)) {
      const better =
        direction === 'max'
          ? metric(candidate) > metric(best)
          : metric(candidate) < metric(best);
      if (better) {
        best = candidate;
      }
    }
    return best.provider;
  }
}
