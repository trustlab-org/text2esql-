import type { IRouter } from '@kbn/core/server';
import { PLUGIN_ROUTE_PREFIX } from '../../common';

/**
 * Health check route.
 *
 * GET /api/query_copilot/health
 *
 * Returns 501 until the health aggregation service is implemented.
 * Shape is pre-defined so clients can begin integration against the contract.
 *
 * Future: aggregate ProviderHealthStatus for all configured providers,
 * surface pipeline queue depth, cache stats, and Elasticsearch reachability.
 */
export function registerHealthRoutes(router: IRouter): void {
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/health`,
      validate: false,
      options: {
        authRequired: true,
        tags: ['access:queryCopilot'],
      },
    },
    async (_context, _request, response) => {
      return response.customError({
        statusCode: 501,
        body: {
          message: 'Not yet implemented',
        },
      });
    }
  );
}
