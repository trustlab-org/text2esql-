import type { PluginConfigDescriptor, PluginInitializerContext } from '@kbn/core/server';
import { configSchema, type QueryCopilotConfig } from './config';

// ---------------------------------------------------------------------------
// Kibana 8.x config registration pattern:
// Export `config` as a typed PluginConfigDescriptor — the framework reads this
// export at plugin load time to register the schema before setup() is called.
// This is what prevents "No validation schema has been defined for [...]".
//
// `exposeToBrowser` whitelists which config keys are sent to the browser; here
// `defaultIndexPattern` is exposed so the public plugin can seed initial state.
// ---------------------------------------------------------------------------
export const config: PluginConfigDescriptor<QueryCopilotConfig> = {
  schema: configSchema,
  exposeToBrowser: { defaultIndexPattern: true },
};

export async function plugin(initializerContext: PluginInitializerContext) {
  const { QueryCopilotPlugin } = await import('./plugin');
  return new QueryCopilotPlugin(initializerContext);
}

export type { QueryCopilotPluginSetup, QueryCopilotPluginStart } from './types';