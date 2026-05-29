import type { PluginInitializerContext } from '@kbn/core/server';
import { configSchema } from './config';

// ---------------------------------------------------------------------------
// Kibana 8.x config registration pattern:
// Export `config` as an object with `schema` — the framework reads this
// export at plugin load time to register the schema before setup() is called.
// This is what prevents "No validation schema has been defined for [...]"
// ---------------------------------------------------------------------------
export const config = {
  schema: configSchema,
};

export async function plugin(initializerContext: PluginInitializerContext) {
  const { QueryCopilotPlugin } = await import('./plugin');
  return new QueryCopilotPlugin(initializerContext);
}

export type { QueryCopilotPluginSetup, QueryCopilotPluginStart } from './types';