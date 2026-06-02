import type { ProviderName } from './provider.types';
import type { InvestigationType } from './intent.types';

/**
 * Canonical wire contract for POST /api/query_copilot/benchmark; structurally
 * mirrors server/services/benchmarking (which keeps its own local definitions).
 */

/**
 * Quality measurement for a single generated KQL query against a benchmark case.
 * All numeric fields are in the range [0, 1].
 */
export interface QualityScore {
  /** Fraction of expected ECS field names present in the generated KQL. */
  readonly fieldCoverage: number;
  /** Fraction of expected filter clauses present in the generated KQL. */
  readonly filterCoverage: number;
  /** Whether the generated KQL parses as valid (non-empty) KQL. */
  readonly syntaxValid: boolean;
  /** Weighted blend of the above. */
  readonly overallScore: number;
}

/** Outcome of running a single benchmark case through the pipeline. */
export interface CaseResult {
  readonly caseId: string;
  readonly investigationType: InvestigationType;
  readonly status: string;
  readonly generatedKQL: string;
  readonly latencyMs: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly quality: QualityScore;
  readonly errorCode: string | null;
}

/** Aggregated results for one provider across the whole dataset. */
export interface ProviderBenchmarkResult {
  readonly provider: ProviderName;
  readonly avgLatencyMs: number;
  readonly p95LatencyMs: number;
  readonly avgTokens: number;
  readonly avgCost: number;
  readonly avgQualityScore: number;
  readonly caseResults: readonly CaseResult[];
}

/** Cross-provider summary used for at-a-glance comparison. */
export interface BenchmarkSummary {
  readonly totalCases: number;
  readonly totalRuns: number;
  readonly bestProviderByQuality: ProviderName | null;
  readonly bestProviderByLatency: ProviderName | null;
  readonly bestProviderByCost: ProviderName | null;
  readonly overallAvgQualityScore: number;
}

/** Full benchmark report returned by `POST /api/query_copilot/benchmark`. */
export interface BenchmarkReport {
  /** ISO 8601 timestamp of when the run started. */
  readonly runAt: string;
  readonly providers: readonly ProviderBenchmarkResult[];
  readonly summary: BenchmarkSummary;
}

/** Request body for `POST /api/query_copilot/benchmark`. */
export interface BenchmarkRunRequest {
  readonly providers?: readonly ProviderName[];
}
