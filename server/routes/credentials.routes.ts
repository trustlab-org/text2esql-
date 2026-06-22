/**
 * Per-user LLM credential routes for the Query Copilot plugin.
 *
 * Exposes GET/POST/DELETE `/api/query_copilot/credentials`, backed by an
 * encrypted saved object keyed by the authenticated user. Keys are stored
 * server-side and encrypted at rest: they are NEVER returned to the browser
 * (only masked metadata + a `hasKey` boolean) and NEVER logged here.
 */

import { schema, type TypeOf } from '@kbn/config-schema';
import { randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { SaveCredentialsInput } from '../services/credentials';
import { PLUGIN_ROUTE_PREFIX, PROVIDER_NAMES } from '../../common';

const providerLiteral = schema.oneOf([
  schema.literal(PROVIDER_NAMES.GEMINI),
  schema.literal(PROVIDER_NAMES.GROQ),
  schema.literal(PROVIDER_NAMES.OLLAMA),
  schema.literal(PROVIDER_NAMES.ANTHROPIC),
  schema.literal(PROVIDER_NAMES.OPENAI),
]);

/**
 * POST body. The apiKey is optional (Ollama needs none; on update an omitted
 * key preserves the stored one) and bounded; it is NEVER logged.
 */
const saveCredentialsBodySchema = schema.object({
  primary: schema.object({
    provider: providerLiteral,
    model: schema.maybe(schema.string({ maxLength: 256 })),
    endpoint: schema.maybe(schema.string({ maxLength: 512 })),
    apiKey: schema.maybe(schema.string({ maxLength: 512 })),
  }),
  fallback: schema.maybe(
    schema.nullable(
      schema.object({
        enabled: schema.boolean(),
        provider: schema.maybe(providerLiteral),
        model: schema.maybe(schema.string({ maxLength: 256 })),
        endpoint: schema.maybe(schema.string({ maxLength: 512 })),
        apiKey: schema.maybe(schema.string({ maxLength: 512 })),
      })
    )
  ),
});

type SaveCredentialsBody = TypeOf<typeof saveCredentialsBodySchema>;

/**
 * Registers the credentials routes. All require authentication and the
 * `access:queryCopilot` tag, and every response carries an `X-Request-ID`
 * correlation header (mirroring the other route groups).
 */
export function registerCredentialsRoutes(router: IRouter, context: QueryCopilotContext): void {
  // ── GET — masked status for the current user ───────────────────────────────
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/credentials`,
      validate: false,
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
      },
    },
    async (ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'GET', request.url.pathname);

      try {
        const coreCtx = await ctx.core;
        const username = coreCtx.security.authc.getCurrentUser()?.username;
        if (!username) {
          return response.unauthorized({ headers });
        }

        const service = context.getCredentialsService?.(request);
        if (!service) {
          return response.customError({
            statusCode: 503,
            headers,
            body: { message: 'Credential storage is not ready.', attributes: { requestId } },
          });
        }

        const masked = await service.getMaskedForUser(username);
        return response.ok({ headers, body: { credentials: masked } });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'credentials_get_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error reading credentials.',
            attributes: { requestId },
          },
        });
      }
    }
  );

  // ── POST — upsert the current user's credentials ───────────────────────────
  router.post(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/credentials`,
      validate: { body: saveCredentialsBodySchema },
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
        const coreCtx = await ctx.core;
        const username = coreCtx.security.authc.getCurrentUser()?.username;
        if (!username) {
          return response.unauthorized({ headers });
        }

        const service = context.getCredentialsService?.(request);
        if (!service) {
          return response.customError({
            statusCode: 503,
            headers,
            body: { message: 'Credential storage is not ready.', attributes: { requestId } },
          });
        }

        const body: SaveCredentialsBody = request.body;

        // The primary apiKey is required the FIRST time it is set (no stored key
        // and none supplied) for every provider except Ollama, which needs none.
        // The check reads only the masked `hasKey` flag — never a key value.
        if (body.primary.provider !== PROVIDER_NAMES.OLLAMA && !body.primary.apiKey) {
          const existing = await service.getMaskedForUser(username);
          if (!existing?.primary.hasKey) {
            return response.customError({
              statusCode: 400,
              headers,
              body: {
                message:
                  'An API key is required for the selected primary provider. Add your key to continue.',
                attributes: { requestId },
              },
            });
          }
        }

        // Cast to the service input shape (fallback provider is required by the
        // service when enabled; an enabled fallback without a provider simply
        // produces no fallback bundle downstream).
        await service.saveForUser(username, body as SaveCredentialsInput);

        const masked = await service.getMaskedForUser(username);
        return response.ok({ headers, body: { credentials: masked } });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'credentials_post_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error saving credentials.',
            attributes: { requestId },
          },
        });
      }
    }
  );

  // ── DELETE — remove the current user's credentials ─────────────────────────
  router.delete(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/credentials`,
      validate: false,
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
      },
    },
    async (ctx, request, response) => {
      const requestId = randomUUID();
      const headers = { 'X-Request-ID': requestId };
      context.logger.logRequest(requestId, 'DELETE', request.url.pathname);

      try {
        const coreCtx = await ctx.core;
        const username = coreCtx.security.authc.getCurrentUser()?.username;
        if (!username) {
          return response.unauthorized({ headers });
        }

        const service = context.getCredentialsService?.(request);
        if (!service) {
          return response.customError({
            statusCode: 503,
            headers,
            body: { message: 'Credential storage is not ready.', attributes: { requestId } },
          });
        }

        await service.deleteForUser(username);
        return response.ok({ headers, body: { deleted: true } });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'credentials_delete_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error deleting credentials.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
