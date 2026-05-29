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
import { configSchema } from './config';
import { ConfigService } from './services';
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
  private readonly initializerContext: PluginInitializerContext;
  private configService!: ConfigService;

  constructor(initializerContext: PluginInitializerContext) {
    this.initializerContext = initializerContext;
    this.logger = initializerContext.logger.get();
  }

  public setup(
    core: CoreSetup,
    _deps: PluginSetupDependencies
  ): QueryCopilotPluginSetup {
    this.logger.info('queryCopilot: setup');

    // ── Config ──────────────────────────────────────────────────────────────
    // Schema is registered via `export const config = { schema: configSchema }`
    // in server/index.ts — Kibana reads that export before calling setup().
    // .get() synchronously returns the resolved, validated config snapshot.
    const config = this.initializerContext.config.get<ReturnType<typeof configSchema.validate>>();

    this.configService = new ConfigService(config, this.logger.get('config'));

    if (!this.configService.isEnabled()) {
      this.logger.warn('queryCopilot: plugin disabled — skipping route registration');
      return {};
    }

    // ── Routes ──────────────────────────────────────────────────────────────
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