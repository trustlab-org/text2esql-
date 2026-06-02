import type { IRouter } from '@kbn/core/server';
import type { QueryCopilotContext } from '../types';
import { registerHealthRoutes } from './health.routes';
import { registerMetricsRoutes } from './metrics.routes';
import { registerProviderRoutes } from './provider.routes';
import { registerQueryRoutes } from './query.routes';
import { registerExecutionRoutes } from './execution.routes';
import { registerBenchmarkRoutes } from './benchmark.routes';

/**
 * Registers all route groups with the Kibana router.
 *
 * pluginContext is threaded through to every route group so handlers have
 * access to config, structured logging, and metrics without reaching into
 * module-level singletons.
 */
export function defineRoutes(router: IRouter, context: QueryCopilotContext): void {
  registerHealthRoutes(router, context);
  registerMetricsRoutes(router, context);
  registerProviderRoutes(router, context);
  registerQueryRoutes(router, context);
  registerExecutionRoutes(router, context);
  registerBenchmarkRoutes(router, context);
}
