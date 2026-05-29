import type { IRouter } from '@kbn/core/server';
import { PLUGIN_ROUTE_PREFIX } from '../../common';

/**
 * Provider registry routes.
 *
 * GET /api/query_copilot/providers
 *
 * Returns 501 until the provider registry service is implemented.
 * Future shape: ProviderMetadata[] for all configured + healthy providers,
 * filtered by the requesting user's RBAC permissions.
 *
 * Future: add POST /providers/:name/test for on-demand connectivity checks.
 */
export function registerProviderRoutes(router: IRouter): void {
  router.get(
    {
      path: `${PLUGIN_ROUTE_PREFIX}/providers`,
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
