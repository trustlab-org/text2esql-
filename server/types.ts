import type { ElasticsearchClient } from '@kbn/core/server';
import type { NavigationServerPluginSetup } from '@kbn/navigation-plugin/server';
import type { RequestCredentials } from '../common/types';
import type { LoggerService } from './services/observability/logger.service';
import type { MetricsService } from './services/observability/metrics.service';
import type { ConfigService } from './services/config/config.service';
import type { ProviderRouter } from './services/providers/router/provider.router';
import type { QueryPipeline } from './services/query/query.pipeline';
import type { CacheService } from './services/cache/cache.service';
import type { QuerySearchProvider } from './services/execution';

// ---------------------------------------------------------------------------
// Plugin dependency contracts
// ---------------------------------------------------------------------------

export interface PluginSetupDependencies {
  navigation: NavigationServerPluginSetup;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface PluginStartDependencies {}

// ---------------------------------------------------------------------------
// Plugin contract surfaces
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface QueryCopilotPluginSetup {}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface QueryCopilotPluginStart {}

// ---------------------------------------------------------------------------
// Plugin context — passed to route handlers and downstream services
// ---------------------------------------------------------------------------

export interface QueryCopilotContext {
  readonly config: ConfigService;
  readonly logger: LoggerService;
  readonly metrics: MetricsService;
  readonly router: ProviderRouter;
  /** Redis-backed result cache; used by the health route to report Redis status. */
  readonly cacheService: CacheService;
  /**
   * Builds a {@link QueryPipeline} bound to a request-scoped Elasticsearch
   * client. Invoked per request so index-mapping reads honour the caller's
   * permissions. When `credentials` are supplied the provider router and
   * correction engine are also rebuilt per request from the caller's own LLM
   * API keys; otherwise the shared boot-time singletons are used. All remaining
   * collaborators (cache, normalizer, etc.) are shared singletons.
   */
  readonly createPipeline: (
    esClient: ElasticsearchClient,
    credentials?: RequestCredentials
  ) => QueryPipeline;
  /**
   * MCP-backed query-execution provider, present only when
   * `queryCopilot.mcp.searchEnabled` is `true`. When present it REPLACES the
   * per-request `asCurrentUser` {@link QueryExecutorService} on the execute
   * route. RBAC note: the MCP path runs as the MCP container's Elasticsearch
   * identity, NOT the requesting user's, so results reflect the container's
   * privileges rather than the caller's.
   */
  readonly mcpSearchProvider?: QuerySearchProvider;
}