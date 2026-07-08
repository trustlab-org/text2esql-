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
 * Extracts the configured provider names from a decrypted credential bundle,
 * tolerating BOTH credential shapes so the benchmark works regardless of whether
 * the multi-provider migration has been applied:
 *   - new: `{ providers: [{ provider }] }`
 *   - legacy: `{ primary: { provider }, fallback?: { provider } }`
 * Deduped, in order. Returns [] when nothing is configured.
 */
function providersFromCredentials(credentials: unknown): ProviderName[] {
  if (!credentials || typeof credentials !== 'object') {
    return [];
  }
  const c = credentials as {
    providers?: ReadonlyArray<{ provider?: ProviderName }>;
    primary?: { provider?: ProviderName } | null;
    fallback?: { provider?: ProviderName } | null;
  };
  const collected: ProviderName[] = [];
  if (Array.isArray(c.providers)) {
    for (const p of c.providers) {
      if (p?.provider) collected.push(p.provider);
    }
  } else {
    if (c.primary?.provider) collected.push(c.primary.provider);
    if (c.fallback?.provider) collected.push(c.fallback.provider);
  }
  // Dedupe, preserving order.
  return collected.filter((p, i) => collected.indexOf(p) === i);
}

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

        const coreCtx = await ctx.core;
        const esClient = coreCtx.elasticsearch.client.asCurrentUser;

        // Resolve the caller's OWN stored LLM credentials (same as /generate).
        // The benchmark must run against the user's per-user encrypted keys —
        // NOT the boot-time kibana.yml config — otherwise a user who added keys
        // only through Settings has no providers to benchmark and gets an empty
        // report ("No providers were benchmarked").
        const username = coreCtx.security.authc.getCurrentUser()?.username;
        const credentialsService = username
          ? context.getCredentialsService?.(request)
          : undefined;
        const credentials = credentialsService
          ? (await credentialsService.getDecryptedCredentialsForUser(username!)) ?? undefined
          : undefined;

        // Default to the providers the user has actually configured (their
        // stored credential slots); fall back to the config-enabled providers
        // only when no per-user credentials exist. An explicit request list wins.
        // Shape-agnostic: works with both the multi-provider and legacy bundles.
        const fromCreds = providersFromCredentials(credentials);
        const configuredProviders: ProviderName[] =
          fromCreds.length > 0 ? fromCreds : [...context.config.getEnabledProviders()];
        const providers: ProviderName[] =
          body.providers && body.providers.length > 0 ? body.providers : configuredProviders;

        if (providers.length === 0) {
          return response.customError({
            statusCode: 422,
            headers,
            body: {
              message:
                'No LLM providers are configured to benchmark. Add at least one API key in Settings.',
              attributes: { requestId },
            },
          });
        }

        // Build the pipeline with the caller's credentials so the router can
        // actually reach those providers (a credential-less pipeline uses the
        // boot-time config router, which has no keys for Settings-added providers).
        const pipeline = context.createPipeline(esClient, credentials);

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