import type {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
} from '@kbn/core/server';

import type {
  QueryCopilotPluginSetup,
  QueryCopilotPluginStart,
  PluginSetupDependencies,
  PluginStartDependencies,
} from './types';
import { defineRoutes } from './routes';

export class QueryCopilotPlugin
  implements
    Plugin<
      QueryCopilotPluginSetup,
      QueryCopilotPluginStart,
      PluginSetupDependencies,
      PluginStartDependencies
    >
{
  private readonly logger: Logger;

  constructor(initializerContext: PluginInitializerContext) {
    this.logger = initializerContext.logger.get();
  }

  public setup(
    core: CoreSetup,
    _deps: PluginSetupDependencies
  ): QueryCopilotPluginSetup {
    this.logger.info('queryCopilot: setup');

    const router = core.http.createRouter();
    defineRoutes(router);

    this.logger.info('queryCopilot: routes registered');

    return {};
  }

  public start(
    _core: CoreStart,
    _deps: PluginStartDependencies
  ): QueryCopilotPluginStart {
    this.logger.info('queryCopilot: start');
    return {};
  }

  public stop(): void {
    this.logger.info('queryCopilot: stop');
  }
}
