/**
 * Model discovery route for the Query Copilot plugin.
 *
 * Exposes `POST /api/query_copilot/models`, listing the chat-capable models
 * available on the caller's account for a given provider — always discovered
 * LIVE from the provider (never a hardcoded list). The key comes from the
 * request body (as the user types it in the settings form) or, when omitted,
 * from the user's encrypted stored credential for that provider.
 *
 * Keys are NEVER logged and NEVER placed in the response or cache in
 * plaintext: the per-route result cache hashes the key (sha256) into its key.
 */

import { schema, type TypeOf } from '@kbn/config-schema';
import { createHash, randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { DiscoveredModel, ModelDiscoveryResponse } from '../../common/types';
import { PLUGIN_ROUTE_PREFIX, PROVIDER_NAMES } from '../../common';
import { ModelDiscoveryService, ModelDiscoveryError } from '../services/models';

const providerLiteral = schema.oneOf([
  schema.literal(PROVIDER_NAMES.GEMINI),
  schema.literal(PROVIDER_NAMES.GROQ),
  schema.literal(PROVIDER_NAMES.OLLAMA),
  schema.literal(PROVIDER_NAMES.ANTHROPIC),
  schema.literal(PROVIDER_NAMES.OPENAI),
]);

/**
 * POST body. The apiKey is optional (falls back to the user's stored
 * credential; Ollama needs none) and bounded; it is NEVER logged.
 * `forceRefresh` bypasses and repopulates the discovery cache (the UI's
 * "Refresh models" button).
 */
const modelDiscoveryBodySchema = schema.object({
  provider: providerLiteral,
  apiKey: schema.maybe(schema.string({ maxLength: 512 })),
  endpoint: schema.maybe(schema.string({ maxLength: 512 })),
  forceRefresh: schema.maybe(schema.boolean()),
});

type ModelDiscoveryBody = TypeOf<typeof modelDiscoveryBodySchema>;

/** Discovery results are cached per provider+key(hash)+endpoint for 5 minutes. */
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedDiscovery {
  readonly models: readonly DiscoveredModel[];
  readonly expiresAt: number;
}

/** sha256 hex digest — used so raw keys never appear in cache keys. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Registers POST /api/query_copilot/models. Requires authentication and the
 * `access:queryCopilot` tag; every response carries the `X-Request-ID`
 * correlation header (mirroring the other route groups).
 */
export function registerModelsRoutes(router: IRouter, context: QueryCopilotContext): void {
  // Stateless service + route-closure cache shared across requests.
  const discoveryService = new ModelDiscoveryService();
  const cache = new Map<string, CachedDiscovery>();

  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/models`,
      validate: { body: modelDiscoveryBodySchema },
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
        body: { accepts: ['application/json'], maxBytes: 1024 * 16 },
      },
    },
    async (ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'POST', request.url.pathname);

      try {
        const body: ModelDiscoveryBody = request.body;
        const provider = body.provider;

        // ── 1. Resolve the credential ────────────────────────────────────────
        // Prefer the raw key/endpoint from the body; otherwise fall back to the
        // user's stored (decrypted server-side) credential slot for this
        // provider, searched by name across the provider list. Never logged.
        let apiKey = body.apiKey;
        let endpoint = body.endpoint;

        if (!apiKey || (provider === PROVIDER_NAMES.OLLAMA && !endpoint)) {
          const coreCtx = await ctx.core;
          const username = coreCtx.security.authc.getCurrentUser()?.username;
          const credentialsService = username
            ? context.getCredentialsService?.(request)
            : undefined;
          const stored = credentialsService
            ? await credentialsService.getDecryptedCredentialsForUser(username!)
            : null;

          const slot = stored?.providers.find((p) => p.provider === provider);

          apiKey = apiKey ?? slot?.apiKey;
          endpoint = endpoint ?? slot?.endpoint;
        }

        // ── 2. Every provider except Ollama needs a key ──────────────────────
        if (provider !== PROVIDER_NAMES.OLLAMA && !apiKey) {
          return response.customError({
            statusCode: 400,
            headers,
            body: {
              message: 'An API key is required to list models for this provider.',
              attributes: { requestId },
            },
          });
        }

        // ── 3. Cache (5-minute TTL; key hashes the API key) ─────────────────
        const cacheKey = `${provider}|${sha256(apiKey ?? '')}|${endpoint ?? ''}`;
        const now = Date.now();
        if (!body.forceRefresh) {
          const cached = cache.get(cacheKey);
          if (cached && cached.expiresAt > now) {
            const cachedBody: ModelDiscoveryResponse = { provider, models: cached.models };
            return response.ok({ headers, body: cachedBody });
          }
        }

        // ── 4. Discover live and repopulate the cache ────────────────────────
        const models = await discoveryService.discoverModels({ provider, apiKey, endpoint });
        cache.set(cacheKey, { models, expiresAt: now + MODEL_CACHE_TTL_MS });

        const responseBody: ModelDiscoveryResponse = { provider, models };
        return response.ok({ headers, body: responseBody });
      } catch (error) {
        if (error instanceof ModelDiscoveryError) {
          // Clamp auth-ish statuses to 400: a 401/403 from this route would be
          // interpreted by Kibana's browser HTTP interceptor as an expired
          // KIBANA session and log the user out. Provider-key failures are a
          // request error, never a Kibana authentication failure.
          const statusCode =
            error.statusCode === 401 || error.statusCode === 403 ? 400 : error.statusCode;
          return response.customError({
            statusCode,
            headers,
            body: { message: error.message, attributes: { requestId } },
          });
        }

        context.logger.logError(requestId, error, { stage: 'models_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error discovering models.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
