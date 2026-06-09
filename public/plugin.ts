import type {
  AppMountParameters,
  CoreSetup,
  Plugin,
  PluginInitializerContext,
} from '@kbn/core/public';

/**
 * Browser-exposed subset of the server config (see `exposeToBrowser` in
 * server/index.ts). Only keys whitelisted there are present at runtime.
 */
interface QueryCopilotClientConfig {
  readonly defaultIndexPattern: string;
}

/**
 * Public (browser) plugin for Query Copilot. Registers the app and mounts the
 * React application lazily on navigation.
 */
export class QueryCopilotPlugin implements Plugin<void, void> {
  constructor(private readonly initializerContext: PluginInitializerContext) {}

  public setup(core: CoreSetup): void {
    const { defaultIndexPattern } =
      this.initializerContext.config.get<QueryCopilotClientConfig>();

    core.application.register({
      id: 'query_copilot',
      title: 'Query Copilot',
      async mount(params: AppMountParameters) {
        const [coreStart] = await core.getStartServices();
        const { renderApp } = await import('./application');
        return renderApp(coreStart, params.element, defaultIndexPattern);
      },
    });
  }

  public start(): void {}

  public stop(): void {}
}
