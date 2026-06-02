import { fromKueryExpression } from '@kbn/es-query';
import type { BenchmarkCase } from './benchmark.dataset';

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
  /** Weighted blend of the above; see {@link QualityScorer} for the weights. */
  readonly overallScore: number;
}

/**
 * Deterministic, pure scorer for generated KQL queries.
 *
 * Overall score weighting:
 *   0.4 * fieldCoverage + 0.3 * filterCoverage + 0.3 * (syntaxValid ? 1 : 0)
 *
 * Field coverage is the heaviest signal (does the query reference the right ECS
 * fields), followed by filter precision and raw syntactic validity, which are
 * weighted equally.
 */
export class QualityScorer {
  /** Field-coverage weight in {@link QualityScore.overallScore}. */
  private static readonly FIELD_WEIGHT = 0.4;
  /** Filter-coverage weight in {@link QualityScore.overallScore}. */
  private static readonly FILTER_WEIGHT = 0.3;
  /** Syntax-validity weight in {@link QualityScore.overallScore}. */
  private static readonly SYNTAX_WEIGHT = 0.3;

  public score(generatedKQL: string, benchmark: BenchmarkCase): QualityScore {
    const fieldCoverage = this.computeFieldCoverage(generatedKQL, benchmark.expectedKQLContains);
    const filterCoverage = this.computeFilterCoverage(generatedKQL, benchmark.expectedFilters);
    const syntaxValid = this.isSyntaxValid(generatedKQL);

    const raw =
      QualityScorer.FIELD_WEIGHT * fieldCoverage +
      QualityScorer.FILTER_WEIGHT * filterCoverage +
      QualityScorer.SYNTAX_WEIGHT * (syntaxValid ? 1 : 0);

    const overallScore = this.clamp01(raw);

    return { fieldCoverage, filterCoverage, syntaxValid, overallScore };
  }

  /**
   * Fraction of expected ECS field names that appear (case-insensitively) in the
   * generated KQL. An empty expectation list scores a perfect 1.
   */
  private computeFieldCoverage(
    generatedKQL: string,
    expectedFields: readonly string[]
  ): number {
    if (expectedFields.length === 0) {
      return 1;
    }
    const haystack = generatedKQL.toLowerCase();
    const matched = expectedFields.filter((field) =>
      haystack.includes(field.toLowerCase())
    ).length;
    return matched / expectedFields.length;
  }

  /**
   * Fraction of expected filter clauses present in the generated KQL. Matching is
   * whitespace-insensitive (so `field:"x"` and `field : "x"` are treated the
   * same). An empty expectation list scores a perfect 1.
   */
  private computeFilterCoverage(
    generatedKQL: string,
    expectedFilters: readonly string[]
  ): number {
    if (expectedFilters.length === 0) {
      return 1;
    }
    const haystack = this.normalize(generatedKQL);
    const matched = expectedFilters.filter((filter) =>
      haystack.includes(this.normalize(filter))
    ).length;
    return matched / expectedFilters.length;
  }

  /**
   * Empty / whitespace-only KQL is treated as invalid (an empty KQL parses as
   * match-all, which is not a meaningful generated query). Otherwise validity is
   * determined by whether `@kbn/es-query` can parse it.
   */
  private isSyntaxValid(generatedKQL: string): boolean {
    if (generatedKQL.trim() === '') {
      return false;
    }
    try {
      fromKueryExpression(generatedKQL);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lowercases, strips spaces around the `:` operator, and collapses runs of
   * whitespace to a single space so filter comparisons are formatting-agnostic.
   */
  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s*:\s*/g, ':')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private clamp01(value: number): number {
    if (value < 0) {
      return 0;
    }
    if (value > 1) {
      return 1;
    }
    return value;
  }
}
