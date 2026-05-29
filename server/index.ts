import type { PluginInitializerContext } from '@kbn/core/server';

//  This exports static code and TypeScript types,
//  as well as, Kibana Platform `plugin()` initializer.

export async function plugin(initializerContext: PluginInitializerContext) {
  const { QueryCopilotPlugin } = await import('./plugin');
  return new QueryCopilotPlugin(initializerContext);
}

export type { QueryCopilotPluginSetup, QueryCopilotPluginStart } from './types';