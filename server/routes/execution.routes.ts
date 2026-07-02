import { schema, type TypeOf } from '@kbn/config-schema';
import { randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import { KQLSyntaxError } from '@kbn/es-query';
import type { QueryCopilotContext } from '../types';
import { QueryExecutorService } from '../services/execution';
import { PLUGIN_ROUTE_PREFIX, QUERY_LANGUAGES, MAX_INDEX_PATTERN_LENGTH } from '../../common';

/** Request body for POST /execute. */
/**
 * Rejects cross-cluster (`:`) and system-index (leading `.`) targets while
 * staying permissive for normal patterns like `fosstlsoc-logs-*`. Applies to
 * both the KQL and ES|QL paths. Closes audit finding F3.
 */
const validateIndexPattern = (value: string): string | undefined => {
  if (value.includes(':')) {
    return 'cross-cluster index patterns (":") are not allowed';
  }
  if (value.split(',').some((part) => part.trim().startsWith('.'))) {
    return 'system-index patterns (leading ".") are not allowed';
  }
  return undefined;
};

const executeRequestBodySchema = schema.object({
  kql: schema.string({ minLength: 1, maxLength: 8192 }),
  // Sized for multi-data-view selections (comma-joined titles).
  indexPattern: schema.string({
    minLength: 1,
    maxLength: MAX_INDEX_PATTERN_LENGTH,
    validate: validateIndexPattern,
  }),
  timeRange: schema.maybe(
    schema.object({
      from: schema.string({ minLength: 1 }),
      to: schema.string({ minLength: 1 }),
    })
  ),
  // Optional query language; defaults to KQL when absent so existing requests
  // behave identically. Carried only — not yet acted upon (KQL execution).
  language: schema.oneOf(
    [
      schema.literal(QUERY_LANGUAGES.KQL),
      schema.literal(QUERY_LANGUAGES.EQL),
      schema.literal(QUERY_LANGUAGES.DSL),
      schema.literal(QUERY_LANGUAGES.ES_SQL),
      schema.literal(QUERY_LANGUAGES.ESQL),
    ],
    { defaultValue: QUERY_LANGUAGES.KQL }
  ),
});

type ExecuteRequestBody = TypeOf<typeof executeRequestBodySchema>;

/**
 * Registers POST /api/query_copilot/execute.
 *
 * Runs a KQL query against the request-scoped Elasticsearch client via a
 * per-request {@link QueryExecutorService} and returns the normalized result.
 * A `KQLSyntaxError` maps to 400; any other error maps to 500. Every response
 * carries the `X-Request-ID` correlation header.
 */
export function registerExecutionRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/execute`,
      validate: { body: executeRequestBodySchema },
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
        body: { accepts: ['application/json'], maxBytes: 1024 * 64 },
      },
    },
    async (ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'POST', request.url.pathname);

      try {
        const body: ExecuteRequestBody = request.body;
        const params = {
          kql: body.kql,
          indexPattern: body.indexPattern,
          timeRange: body.timeRange,
          // Carried through to QueryExecutionParams; execution still runs KQL.
          language: body.language,
        };

        let result;
        if (params.language === QUERY_LANGUAGES.ESQL) {
          // ES|QL ALWAYS runs as asCurrentUser via the native _query endpoint —
          // never through the MCP shared-identity path, regardless of the MCP flag.
          const coreCtx = await ctx.core;
          const esClient = coreCtx.elasticsearch.client.asCurrentUser;
          result = await new QueryExecutorService(esClient, context.logger).execute(params);
        } else if (context.mcpSearchProvider) {
          // MCP SEARCH path (queryCopilot.mcp.searchEnabled). RBAC: runs as the MCP
          // container's ES identity (Aryan), NOT asCurrentUser. If the MCP server is
          // unreachable the typed McpConnectionError/McpTimeoutError propagates to the
          // catch below (mapped to 500) — we do NOT fall back to asCurrentUser.
          result = await context.mcpSearchProvider.execute(params);
        } else {
          const coreCtx = await ctx.core;
          const esClient = coreCtx.elasticsearch.client.asCurrentUser;
          result = await new QueryExecutorService(esClient, context.logger).execute(params);
        }

        return response.ok({ headers, body: result });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'execute_route' });
        const statusCode = error instanceof KQLSyntaxError ? 400 : 500;
        return response.customError({
          statusCode,
          headers,
          body: {
            message: error instanceof Error ? error.message : 'Query execution failed.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
