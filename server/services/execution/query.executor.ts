/**
 * Executes a KQL query against Elasticsearch and normalizes the result.
 *
 * The executor builds a DSL query from the KQL via `@kbn/es-query`'s
 * `buildEsQuery`, optionally constrains it to a time range, runs the search
 * with a 30s timeout, and hands the hits to {@link ResultNormalizer}.
 */

import { randomUUID } from 'node:crypto';
import type { ElasticsearchClient } from '@kbn/core/server';
import type { QueryExecutionParams, QueryExecutionResult } from '../../../common/types';
import { QUERY_LANGUAGES } from '../../../common';
import type { LoggerService } from '../observability/logger.service';
import { ResultNormalizer } from './result.normalizer';
import { buildQueryDsl, DEFAULT_MAX_RESULTS, TIMESTAMP_SORT } from './search.query.builder';

/** Shared request-timeout budget for both the KQL `_search` and ES|QL `_query` paths. */
const EXECUTE_TIMEOUT_MS = 30_000;

/**
 * Common contract for a query-execution backend: given
 * {@link QueryExecutionParams}, produce a normalized {@link QueryExecutionResult}.
 *
 * Implemented by both {@link QueryExecutorService} (the `asCurrentUser` ES path)
 * and the MCP-backed search provider, so the execute route can branch between
 * them behind a feature flag without knowing which is in play.
 */
export interface QuerySearchProvider {
  execute(params: QueryExecutionParams): Promise<QueryExecutionResult>;
}

/** Runs KQL queries against Elasticsearch and returns normalized results. */
export class QueryExecutorService implements QuerySearchProvider {
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
    // ES|QL runs natively via the _query endpoint as asCurrentUser (per-user
    // RBAC). KQL (the default, or any non-ES|QL language) keeps the existing
    // _search path unchanged below.
    if (params.language === QUERY_LANGUAGES.ESQL) {
      return this.executeEsql(params);
    }

    const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;
    const execId = randomUUID();

    // Build the KQL DSL (incl. optional time-range wrap). `buildQueryDsl` throws
    // `KQLSyntaxError` on invalid KQL. Shared with the MCP search path so both
    // build the identical query.
    const finalQuery = buildQueryDsl(params.kql, params.timeRange);

    try {
      const response = await this.esClient.search<Record<string, unknown>>(
        {
          index: params.indexPattern,
          query: finalQuery,
          sort: TIMESTAMP_SORT,
          size: maxResults,
          track_total_hits: true,
          timeout: '30s',
        },
        { requestTimeout: EXECUTE_TIMEOUT_MS }
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

  /**
   * Executes an ES|QL statement via the native `_query` endpoint and normalizes
   * the columnar response. The ES|QL string carries its own `FROM <pattern>`
   * (and any time filtering), so `indexPattern`/`timeRange` are intentionally NOT
   * applied here — re-applying them would double-target the query. Runs as the
   * request-scoped `asCurrentUser` client (per-user RBAC), never via MCP.
   */
  private async executeEsql(params: QueryExecutionParams): Promise<QueryExecutionResult> {
    const execId = randomUUID();
    try {
      const response = await this.esClient.esql.query(
        { query: params.kql },
        { requestTimeout: EXECUTE_TIMEOUT_MS }
      );

      const result = this.normalizer.normalizeEsql(response);

      this.logger.logPipelineStage(execId, 'query_execute', result.tookMs, {
        language: QUERY_LANGUAGES.ESQL,
        total: result.total,
        rows: result.rows.length,
      });

      return result;
    } catch (error) {
      this.logger.logError(execId, error, {
        stage: 'query_execute',
        language: QUERY_LANGUAGES.ESQL,
      });
      throw error;
    }
  }
}
