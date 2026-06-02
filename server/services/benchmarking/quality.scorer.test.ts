import { QualityScorer } from './quality.scorer';
import type { BenchmarkCase } from './benchmark.dataset';
import { INVESTIGATION_TYPES } from '../../../common';

const baseCase: BenchmarkCase = {
  id: 'test-01',
  investigationType: INVESTIGATION_TYPES.BRUTE_FORCE,
  naturalLanguageQuery: 'failed logins',
  expectedKQLContains: ['event.outcome', 'source.ip'],
  expectedFilters: ['event.outcome : "failure"'],
};

describe('QualityScorer', () => {
  const scorer = new QualityScorer();

  it('awards full coverage and syntax for a perfect query', () => {
    const kql = 'event.outcome : "failure" and source.ip : "10.0.0.1"';
    const result = scorer.score(kql, baseCase);

    expect(result.fieldCoverage).toBe(1);
    expect(result.filterCoverage).toBe(1);
    expect(result.syntaxValid).toBe(true);
    expect(result.overallScore).toBeCloseTo(1, 10);
  });

  it('reports partial field coverage', () => {
    const kql = 'event.outcome : "failure"';
    const result = scorer.score(kql, baseCase);

    // 1 of 2 expected fields present.
    expect(result.fieldCoverage).toBe(0.5);
    expect(result.filterCoverage).toBe(1);
    expect(result.syntaxValid).toBe(true);
    // 0.4*0.5 + 0.3*1 + 0.3*1 = 0.8
    expect(result.overallScore).toBeCloseTo(0.8, 10);
  });

  it('treats empty KQL as syntactically invalid', () => {
    const result = scorer.score('   ', baseCase);

    expect(result.syntaxValid).toBe(false);
    expect(result.fieldCoverage).toBe(0);
    expect(result.filterCoverage).toBe(0);
    // No field, no filter, no syntax → 0.
    expect(result.overallScore).toBe(0);
  });

  it('reflects only the matching weights when fields/filters partially match', () => {
    // Empty KQL but a case with no expectations → coverage is 1 for both,
    // and only the syntax weight (0.3) is lost.
    const emptyExpectationsCase: BenchmarkCase = {
      ...baseCase,
      expectedKQLContains: [],
      expectedFilters: [],
    };
    const result = scorer.score('', emptyExpectationsCase);

    expect(result.fieldCoverage).toBe(1);
    expect(result.filterCoverage).toBe(1);
    expect(result.syntaxValid).toBe(false);
    // 0.4*1 + 0.3*1 + 0.3*0 = 0.7
    expect(result.overallScore).toBeCloseTo(0.7, 10);
  });

  it('matches filters regardless of whitespace around the colon', () => {
    const kql = 'event.outcome:"failure" and source.ip:"10.0.0.1"';
    const result = scorer.score(kql, baseCase);

    expect(result.filterCoverage).toBe(1);
  });

  it('matches fields case-insensitively', () => {
    const kql = 'EVENT.OUTCOME : "failure" and SOURCE.IP : "10.0.0.1"';
    const result = scorer.score(kql, baseCase);

    expect(result.fieldCoverage).toBe(1);
  });

  it('marks invalid KQL as syntactically invalid', () => {
    const kql = 'event.outcome : ((( "failure"';
    const result = scorer.score(kql, baseCase);

    expect(result.syntaxValid).toBe(false);
  });

  it('clamps the overall score to the [0, 1] range', () => {
    const result = scorer.score('event.outcome : "failure" and source.ip : "1.1.1.1"', baseCase);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });
});
