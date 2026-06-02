import { schema, type TypeOf } from '@kbn/config-schema';
import { randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { ProviderName } from '../../common';
import { PLUGIN_ROUTE_PREFIX, PROVIDER_NAMES } from '../../common';
import { BenchmarkRunner, QualityScorer } from '../services/benchmarking';

const providerLiteral = schema.oneOf([
  schema.literal(PROVIDER_NAMES.GEMINI),
  schema.literal(PROVIDER_NAMES.GROQ),
  schema.literal(PROVIDER_NAMES.OLLAMA),
  schema.literal(PROVIDER_NAMES.ANTHROPIC),
  schema.literal(PROVIDER_NAMES.OPENAI),
]);

const benchmarkRequestBodySchema = schema.object({
  providers: schema.maybe(schema.arrayOf(providerLiteral)),
});

type BenchmarkRequestBody = TypeOf<typeof benchmarkRequestBodySchema>;

/**
 * Registers POST /api/query_copilot/benchmark.
 *
 * Runs the full query-generation pipeline across the requested (or enabled)
 * providers × the benchmark dataset, scores each generated query, and returns a
 * comparative report.
 *
 * NOTE: this endpoint is LONG-RUNNING — it executes the pipeline once per
 * provider × benchmark case — and is intended for admin / offline evaluation,
 * not interactive use.
 *
 * ADMIN-ONLY: the `access:queryCopilotAdmin` tag is Kibana's standard
 * enforcement hook for an internal application privilege. For the platform to
 * actually enforce it, the `queryCopilotAdmin` privilege must be registered via
 * the features plugin (out of scope here). This tag is the gate the platform
 * checks once that privilege exists.
 */
export function registerBenchmarkRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/benchmark`,
      validate: { body: benchmarkRequestBodySchema },
      options: {
        authRequired: true,
        tags: ['access:queryCopilotAdmin'],
        body: { accepts: ['application/json'], maxBytes: 1024 * 16 },
      },
    },
    async (ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'POST', request.url.pathname);

      try {
        const body: BenchmarkRequestBody = request.body;

        // Use the explicitly requested providers if any were given; otherwise
        // benchmark whichever providers are currently enabled in config.
        const providers: ProviderName[] =
          body.providers && body.providers.length > 0
            ? body.providers
            : [...context.config.getEnabledProviders()];

        const coreCtx = await ctx.core;
        const esClient = coreCtx.elasticsearch.client.asCurrentUser;
        const pipeline = context.createPipeline(esClient);

        const runner = new BenchmarkRunner(pipeline, new QualityScorer(), context.logger);
        const report = await runner.run(providers);

        return response.ok({ headers, body: report });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'benchmark_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error running the benchmark.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
