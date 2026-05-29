import type { NavigationServerPluginSetup } from '@kbn/navigation-plugin/server';

// ---------------------------------------------------------------------------
// Plugin dependency contracts
// Kibana injects these at setup/start time based on kibana.json declarations.
// ---------------------------------------------------------------------------

/**
 * Plugins available during setup() — before Elasticsearch/SavedObjects are ready.
 * Add optional plugin dependencies here as they are declared in kibana.json.
 */
export interface PluginSetupDependencies {
  // navigation is declared as requiredPlugin in kibana.json
  navigation: NavigationServerPluginSetup;
}

/**
 * Plugins available during start() — Elasticsearch and SavedObjects are ready.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PluginStartDependencies {}

// ---------------------------------------------------------------------------
// This plugin's own public contract surfaces
// Other plugins depend on these types via their own PluginSetupDependencies.
// ---------------------------------------------------------------------------

/**
 * Exposed on setup(). Currently empty — extend as the plugin matures
 * (e.g. expose a query generation service for other plugins to consume).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface QueryCopilotPluginSetup {}

/**
 * Exposed on start(). Currently empty.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface QueryCopilotPluginStart {}
