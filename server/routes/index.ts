import type { IRouter } from '@kbn/core/server';
import { registerHealthRoutes } from './health.routes';
import { registerProviderRoutes } from './provider.routes';
import { registerQueryRoutes } from './query.routes';

/**
 * Registers all route groups with the Kibana router.
 *
 * Ordering convention: health → providers → query (coarse → fine-grained).
 * Add new route group registrations here as the plugin grows.
 *
 * Each register* function is responsible for its own path prefix, validation
 * schema, auth tags, and handler logic — this coordinator only wires them up.
 */
export function defineRoutes(router: IRouter): void {
  registerHealthRoutes(router);
  registerProviderRoutes(router);
  registerQueryRoutes(router);
}
