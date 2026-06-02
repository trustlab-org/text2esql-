/**
 * Executes a KQL query against Elasticsearch and normalizes the result.
 *
 * The executor builds a DSL query from the KQL via `@kbn/es-query`'s
 * `buildEsQuery`, optionally constrains it to a time range, runs the search
 * with a 30s timeout, and hands the hits to {@link ResultNormalizer}.
 */

import { randomUUID } from 'node:crypto';
import type { ElasticsearchClient } from '@kbn/core/server';
import { buildEsQuery } from '@kbn/es-query';
import type { estypes } from '@elastic/elasticsearch';
import type { QueryExecutionParams, QueryExecutionResult } from '../../../common/types';
import type { LoggerService } from '../observability/logger.service';
import { ResultNormalizer } from './result.normalizer';

/** Runs KQL queries against Elasticsearch and returns normalized results. */
export class QueryExecutorService {
  private readonly normalizer: ResultNormalizer;

  constructor(
    private readonly esClient: ElasticsearchClient,
    private readonly logger: LoggerService,
    normalizer: ResultNormalizer = new ResultNormalizer()
  ) {
    this.normalizer = normalizer;
  }

  /**
   * Execute a KQL query and return a normalized, tabular result.
   *
   * @throws re-throws any Elasticsearch error (including `KQLSyntaxError` from
   *   `buildEsQuery`) so the route can map it to an HTTP status.
   */
  async execute(params: QueryExecutionParams): Promise<QueryExecutionResult> {
    const maxResults = params.maxResults ?? 100;
    const execId = randomUUID();

    // Build the KQL DSL. `buildEsQuery` throws `KQLSyntaxError` on invalid KQL.
    const kqlDsl = buildEsQuery(undefined, { query: params.kql, language: 'kuery' }, []);

    // Combine with an optional time range filter.
    const finalQuery: estypes.QueryDslQueryContainer = params.timeRange
      ? {
          bool: {
            must: [kqlDsl],
            filter: [
              {
                range: {
                  '@timestamp': {
                    gte: params.timeRange.from,
                    lte: params.timeRange.to,
                    format: 'strict_date_optional_time||epoch_millis',
                  },
                },
              },
            ],
          },
        }
      : kqlDsl;

    try {
      const response = await this.esClient.search<Record<string, unknown>>(
        {
          index: params.indexPattern,
          query: finalQuery,
          size: maxResults,
          track_total_hits: true,
          timeout: '30s',
        },
        { requestTimeout: 30_000 }
      );

      const total =
        typeof response.hits.total === 'number'
          ? response.hits.total
          : response.hits.total?.value ?? 0;
      const tookMs = response.took ?? 0;
      const timedOut = response.timed_out ?? false;

      const { columns, rows } = this.normalizer.normalizeHits(response.hits.hits, 20);

      this.logger.logPipelineStage(execId, 'query_execute', tookMs, {
        indexPattern: params.indexPattern,
        total,
        timedOut,
        rows: rows.length,
      });

      return { columns, rows, total, tookMs, timedOut };
    } catch (error) {
      this.logger.logError(execId, error, {
        stage: 'query_execute',
        indexPattern: params.indexPattern,
      });
      throw error;
    }
  }
}
