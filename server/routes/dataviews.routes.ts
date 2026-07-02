/**
 * Data Views route for the Query Copilot plugin.
 *
 * Exposes `GET /api/query_copilot/data-views`, listing the Kibana Data Views
 * (`index-pattern` saved objects) visible to the CURRENT USER via the
 * request-scoped saved objects client. There is deliberately no server-side
 * caching and no hardcoded pattern names: every call reflects newly created
 * data views immediately.
 */

import { randomUUID } from 'node:crypto';
import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import type { DataViewSummary, DataViewsResponse } from '../../common/types';
import { PLUGIN_ROUTE_PREFIX } from '../../common';

/** Attributes we read off each `index-pattern` saved object. */
interface IndexPatternAttributes {
  readonly title?: string;
  readonly name?: string;
}

/**
 * Registers GET /api/query_copilot/data-views. Requires authentication and the
 * `access:queryCopilot` tag; every response carries the `X-Request-ID`
 * correlation header (mirroring the other route groups).
 */
export function registerDataViewsRoutes(router: IRouter, context: QueryCopilotContext): void {
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/data-views`,
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
        const soClient = coreCtx.savedObjects.client;

        const result: {
          saved_objects?: Array<{ id: string; attributes?: IndexPatternAttributes }>;
        } = await soClient.find({
          type: 'index-pattern',
          perPage: 1000,
          fields: ['title', 'name'],
        });

        // Defensive narrowing: the client typing here is loose, so treat the
        // result shape as unknown-ish and skip anything without a usable title.
        const savedObjects: ReadonlyArray<{
          id: string;
          attributes?: IndexPatternAttributes;
        }> = Array.isArray(result?.saved_objects) ? result.saved_objects : [];

        const dataViews: DataViewSummary[] = [];
        for (const so of savedObjects) {
          const title = so.attributes?.title;
          if (typeof title !== 'string' || title.length === 0) {
            continue;
          }
          const name = so.attributes?.name;
          dataViews.push({
            id: so.id,
            title,
            name: typeof name === 'string' && name.length > 0 ? name : title,
          });
        }

        dataViews.sort((a, b) => a.name.localeCompare(b.name));

        const body: DataViewsResponse = { dataViews };
        return response.ok({ headers, body });
      } catch (error) {
        context.logger.logError(requestId, error, { stage: 'data_views_route' });
        return response.customError({
          statusCode: 500,
          headers,
          body: {
            message:
              error instanceof Error ? error.message : 'Unexpected error listing data views.',
            attributes: { requestId },
          },
        });
      }
    }
  );
}
