import type {
  PluginInitializerContext,
  CoreSetup,
  CoreStart,
  Plugin,
  Logger,
  KibanaRequest,
  SavedObjectsClientContract,
} from '@kbn/core/server';
import type { EncryptedSavedObjectsClient } from '@kbn/encrypted-saved-objects-plugin/server';

import type {
  QueryCopilotPluginSetup,
  QueryCopilotPluginStart,
  PluginSetupDependencies,
  PluginStartDependencies,
  QueryCopilotContext,
} from './types';
import { configSchema } from './config';
import {
  ConfigService,
  LoggerService,
  MetricsService,
  ProviderRouter,
  HealthMonitor,
  PriorityRoutingStrategy,
  ProviderFactory,
  buildRequestRouter,
  TokenEstimatorService,
  CostEstimatorService,
} from './services';
import type { ILLMProvider } from './services';
import type { ProviderName } from '../common';
import { PROVIDER_NAMES } from '../common';
import type { ProviderCredential, RequestCredentials } from '../common/types';
import { defineRoutes } from './routes';
import { CacheService, RedisClientFactory } from './services/cache';
import { QueryNormalizer, IntentExtractorService } from './services/intent';
import { ESMappingFetcher, FieldValuesFetcher, ECSContextMapper } from './services/schema';
import { PromptBuilder } from './services/prompt';
import { KQLValidatorService } from './services/validation';
import { CorrectionEngine, CorrectionPromptBuilder } from './services/correction';
import { QueryPipeline } from './services/query';
import { McpClientService, McpMappingProvider, McpSearchProvider } from './services/mcp';
import { CredentialsService } from './services/credentials';
import { credentialsType, CREDENTIALS_SO_TYPE } from './saved_objects/credentials.type';
import type { ElasticsearchClient } from '@kbn/core/server';
import type Redis from 'ioredis';

export class QueryCopilotPlugin
  implements Plugin<
  QueryCopilotPluginSetup,
  QueryCopilotPluginStart,
  PluginSetupDependencies,
  PluginStartDependencies
>
{
  private readonly logger: Logger;
  private readonly initializerContext: PluginInitializerContext;
  private configService!: ConfigService;
  private healthMonitor!: HealthMonitor;
  private providerMap?: ReadonlyMap<ProviderName, ILLMProvider>;
  private redisClient?: Redis;
  private mcpClient?: McpClientService;
  /**
   * start()-time contracts needed to build a per-request {@link CredentialsService}.
   * Populated in start(); read lazily by the context's getCredentialsService so
   * route handlers can resolve encrypted per-user credentials. Undefined until
   * start() has run.
   */
  private credentialsRuntime?: {
    esoClient: EncryptedSavedObjectsClient;
    getScopedClient: (request: KibanaRequest) => SavedObjectsClientContract;
  };

  constructor(initializerContext: PluginInitializerContext) {
    this.initializerContext = initializerContext;
    this.logger = initializerContext.logger.get();
  }

  public setup(
    core: CoreSetup,
    deps: PluginSetupDependencies
  ): QueryCopilotPluginSetup {
    this.logger.info('queryCopilot: setup');

    // ── Per-user encrypted credentials (Stage 3) ──────────────────────────────
    // The saved object stores each user's LLM keys encrypted at rest. It is
    // registered with core (so the type exists) and with encryptedSavedObjects
    // (so the apiKey attributes are encrypted/decrypted). The actual storage
    // service is built per request in start() once the ESO/SO start contracts
    // are available.
    core.savedObjects.registerType(credentialsType);
    // This ESO version uses an AAD allowlist (`attributesToIncludeInAAD`) rather
    // than an exclude-list; we bind the plaintext provider metadata into the AAD
    // so a key cannot be lifted onto a different provider/endpoint record. The
    // two *ApiKey attributes are the encrypted ones and must NOT appear here.
    deps.encryptedSavedObjects.registerType({
      type: CREDENTIALS_SO_TYPE,
      // `providerKeysJson` is the multi-provider key blob (new source of truth).
      // The legacy `primaryApiKey`/`fallbackApiKey` MUST stay registered so docs
      // written before the migration still decrypt. `attributesToEncrypt` may be
      // extended safely; `attributesToIncludeInAAD` must NOT change (it would
      // break decryption of existing docs), so the new blob is bound to the same
      // AAD as the legacy keys — which is why saveForUser keeps the plaintext
      // primary* AAD fields in sync with the chosen primary provider.
      attributesToEncrypt: new Set(['providerKeysJson', 'primaryApiKey', 'fallbackApiKey']),
      attributesToIncludeInAAD: new Set([
        'primaryProvider',
        'primaryModel',
        'primaryEndpoint',
        'fallbackEnabled',
        'fallbackProvider',
        'fallbackModel',
        'fallbackEndpoint',
      ]),
    });

    // ── Config ──────────────────────────────────────────────────────────────
    const config = this.initializerContext.config.get<ReturnType<typeof configSchema.validate>>();
    this.configService = new ConfigService(config, this.logger.get('config'));

    if (!this.configService.isEnabled()) {
      this.logger.warn('queryCopilot: plugin disabled — skipping route registration');
      return {};
    }

    // ── Observability ────────────────────────────────────────────────────────
    const loggerService = new LoggerService(this.logger.get('requests'));
    const metricsService = new MetricsService();

    // ── Provider instances ────────────────────────────────────────────────────
    const providerMap = this.buildProviderMap();
    this.providerMap = providerMap;

    if (providerMap.size === 0) {
      this.logger.warn('queryCopilot: no providers are enabled — all LLM routes will fail');
    }

    // ── Health monitor ────────────────────────────────────────────────────────
    this.healthMonitor = new HealthMonitor(
      providerMap,
      this.logger.get('health'),
      {
        intervalMs: 60_000,
        failureThreshold: 2,
        recoveryThreshold: 1,
      }
    );
    this.healthMonitor.start();

    // ── Router ────────────────────────────────────────────────────────────────
    const routingStrategy = new PriorityRoutingStrategy();
    const providerRouter = new ProviderRouter(
      providerMap,
      this.healthMonitor,
      routingStrategy,
      loggerService
    );

    // ── Pipeline collaborators (shared singletons) ─────────────────────────────
    const redisClient = new RedisClientFactory(this.logger.get('redis')).createClient(
      this.configService.getRedisConfig()
    );
    this.redisClient = redisClient;
    const cacheService = new CacheService(redisClient, this.configService, loggerService);
    const normalizer = new QueryNormalizer();
    const intentExtractor = new IntentExtractorService();
    const ecsMapper = new ECSContextMapper();
    const promptBuilder = new PromptBuilder();
    const validator = new KQLValidatorService();
    const correctionEngine = new CorrectionEngine(
      new CorrectionPromptBuilder(),
      providerRouter,
      validator,
      loggerService,
      this.configService.getMaxCorrectionRetries()
    );
    const tokenEstimator = new TokenEstimatorService();
    const costEstimator = new CostEstimatorService();
    const esMappingLogger = this.logger.get('schema');

    // ── MCP mapping path (feature-flagged) ─────────────────────────────────────
    // The MCP client is constructed unconditionally (so stop() can close it and
    // start() can opportunistically connect it), but it is only wired into the
    // pipeline's index-mapping lookup when queryCopilot.mcp.enabled is true.
    const mcpClient = new McpClientService(this.configService, this.logger.get('mcp'));
    this.mcpClient = mcpClient;
    const mcpEnabled = this.configService.getMcpConfig().enabled;
    const mcpMappingProvider = mcpEnabled ? new McpMappingProvider(mcpClient) : undefined;
    if (mcpEnabled) {
      this.logger.info(
        'queryCopilot: MCP mapping path ENABLED — get_mappings via MCP server ' +
          '(RBAC: MCP container identity, not asCurrentUser)'
      );
    }

    // ── MCP search path (separately feature-flagged) ───────────────────────────
    // When queryCopilot.mcp.searchEnabled is true, query EXECUTION is served by
    // the MCP server's `search` tool instead of the per-request asCurrentUser
    // QueryExecutorService. This is independent of the mapping flag above.
    const mcpSearchEnabled = this.configService.getMcpConfig().searchEnabled;
    const mcpSearchProvider = mcpSearchEnabled ? new McpSearchProvider(mcpClient) : undefined;
    if (mcpSearchEnabled) {
      this.logger.info(
        'queryCopilot: MCP SEARCH path ENABLED — query execution via MCP server ' +
          '(RBAC: MCP container identity, not asCurrentUser)'
      );
    }

    // A QueryPipeline is built per request, bound to the request-scoped ES client
    // (so index-mapping reads honour the requesting user's permissions). The other
    // collaborators above are stateless singletons created once here.
    // When the request carries the caller's own credentials, the router and
    // correction engine are rebuilt per request from those keys (request-scoped,
    // discarded afterwards). Without credentials the shared boot-time singletons
    // are used, preserving back-compat. API keys flow only through the factory
    // into the providers and are never logged here.
    const maxCorrectionRetries = this.configService.getMaxCorrectionRetries();
    const createPipeline = (
      esClient: ElasticsearchClient,
      credentials?: RequestCredentials
    ): QueryPipeline => {
      const requestRouter = credentials
        ? buildRequestRouter(credentials, loggerService)
        : providerRouter;
      const requestCorrectionEngine = credentials
        ? new CorrectionEngine(
            new CorrectionPromptBuilder(),
            requestRouter,
            validator,
            loggerService,
            maxCorrectionRetries
          )
        : correctionEngine;

      return new QueryPipeline(
        cacheService,
        normalizer,
        intentExtractor,
        new ESMappingFetcher(esClient, esMappingLogger),
        new FieldValuesFetcher(esClient, esMappingLogger),
        ecsMapper,
        promptBuilder,
        requestRouter,
        validator,
        requestCorrectionEngine,
        tokenEstimator,
        costEstimator,
        loggerService,
        metricsService,
        mcpMappingProvider
      );
    };

    // ── Plugin context ────────────────────────────────────────────────────────
    const pluginContext: QueryCopilotContext = {
      config: this.configService,
      logger: loggerService,
      metrics: metricsService,
      router: providerRouter,
      cacheService,
      createPipeline,
      mcpSearchProvider,
      // Lazily builds a per-request CredentialsService once start() has wired the
      // ESO start client + scoped-SO-client factory. Returns undefined before
      // start(); route handlers treat that as "not ready".
      getCredentialsService: (request: KibanaRequest): CredentialsService | undefined => {
        const runtime = this.credentialsRuntime;
        if (!runtime) {
          return undefined;
        }
        return new CredentialsService(runtime.esoClient, () =>
          runtime.getScopedClient(request)
        );
      },
    };

    // ── Routes ────────────────────────────────────────────────────────────────
    const router = core.http.createRouter();
    defineRoutes(router, pluginContext);

    this.logger.info('queryCopilot: routes registered');

    return {};
  }

  public async start(
    core: CoreStart,
    deps: PluginStartDependencies
  ): Promise<QueryCopilotPluginStart> {
    this.logger.info('queryCopilot: start');

    // Wire the per-user credential runtime now that start-time contracts exist.
    // - esoClient decrypts the apiKey attributes (getDecryptedAsInternalUser).
    // - getScopedClient yields a request-scoped SO client that INCLUDES the
    //   hidden credentials type, so reads/writes honour the caller's space+RBAC.
    this.credentialsRuntime = {
      esoClient: deps.encryptedSavedObjects.getClient({
        includedHiddenTypes: [CREDENTIALS_SO_TYPE],
      }),
      getScopedClient: (request: KibanaRequest) =>
        core.savedObjects.getScopedClient(request, {
          includedHiddenTypes: [CREDENTIALS_SO_TYPE],
        }),
    };

    await this.validateProviders();

    // Best-effort eager connect to the MCP server when the mapping path is enabled.
    // This is purely an optimisation: McpClientService lazily connects on first use
    // and surfaces typed McpConnectionError/McpTimeoutError at request time, so a
    // failure here MUST NOT block Kibana startup — log and continue.
    const mcpConfig = this.configService.getMcpConfig();
    if ((mcpConfig.enabled || mcpConfig.searchEnabled) && this.mcpClient) {
      try {
        await this.mcpClient.connect();
        this.logger.info('queryCopilot: connected to MCP server');
      } catch (err) {
        this.logger.error(
          `queryCopilot: MCP server connect failed at startup (continuing; will retry lazily per request): ${err}`
        );
      }
    }

    return {};
  }

  public stop(): void {
    this.logger.info('queryCopilot: stop');
    if (this.healthMonitor) {
      this.healthMonitor.stop();
    }
    if (this.redisClient) {
      this.redisClient.disconnect();
    }
    // Fire-and-forget MCP teardown (mirrors the redisClient.disconnect() pattern);
    // close() is non-throwing and swallows its own errors.
    void this.mcpClient?.close();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Validates the configured model for every provider that can enumerate its
   * available models (currently Gemini, via v1beta listModels). This runs at
   * start() and is GRACEFUL: it never throws out of start() — Kibana must keep
   * running and the router's fallback chain handles a single bad provider.
   *
   * Reconciliation of "graceful at startup" vs "typed ProviderUnavailableError
   * during initialization": the provider CACHES a typed ProviderUnavailableError
   * at validation time when discovery affirmatively reports its model is
   * unavailable. That cached error is then thrown (without any network call) on
   * the next complete(), and makes isHealthy() return false immediately. So the
   * typed error is surfaced deterministically at request/health-check time
   * rather than by crashing the plugin at boot.
   */
  private async validateProviders(): Promise<void> {
    if (!this.providerMap) {
      return;
    }

    for (const [name, provider] of this.providerMap) {
      if (typeof provider.validateModelAvailability !== 'function') {
        continue;
      }

      try {
        const { configuredModel, available, supportedModels } =
          await provider.validateModelAvailability();

        this.logger.info(
          `queryCopilot: provider ${name} model="${configuredModel}" available=${available}; ` +
            `${supportedModels.length} generateContent models discovered`
        );

        if (supportedModels.length) {
          this.logger.info(
            `queryCopilot: provider ${name} discovered models: ${supportedModels
              .slice(0, 30)
              .join(', ')}${supportedModels.length > 30 ? ', …' : ''}`
          );
        }

        if (!available) {
          this.logger.error(
            `queryCopilot: provider ${name} configured model "${configuredModel}" is NOT available — ` +
              `marking unhealthy. Set query_copilot.providers.${name}.model to one of the discovered models.`
          );
          // The provider's isHealthy() now returns false instantly via the cached
          // typed error, so checkProvider records an unhealthy state deterministically
          // without an extra network round-trip.
          await this.healthMonitor.checkProvider(name);
        }
      } catch (err) {
        this.logger.warn(
          `queryCopilot: model validation for ${name} could not complete: ${err}`
        );
      }
    }
  }

  /**
   * Instantiates a provider for every enabled entry in config.
   * Disabled providers are skipped — the router only sees enabled ones.
   * Config validation has already run at this point (Kibana schema).
   */
  private buildProviderMap(): ReadonlyMap<ProviderName, ILLMProvider> {
    const map = new Map<ProviderName, ILLMProvider>();
    const factory = new ProviderFactory();

    // Each enabled entry is turned into a per-provider credential and handed to
    // the SAME factory used for per-request providers, so the construction logic
    // (model defaults, maxTokens/timeoutMs/temperature) lives in one place. The
    // enabled/apiKey gating below is unchanged from before.
    const register = (name: ProviderName, cred: ProviderCredential): void => {
      map.set(name, factory.createProvider(cred));
      this.logger.info(`queryCopilot: registered ${name} provider`);
    };

    const geminiCfg = this.configService.getGeminiConfig();
    if (geminiCfg.enabled && geminiCfg.apiKey) {
      register(PROVIDER_NAMES.GEMINI, {
        provider: PROVIDER_NAMES.GEMINI,
        apiKey: geminiCfg.apiKey,
        model: geminiCfg.model,
      });
    }

    const groqCfg = this.configService.getGroqConfig();
    if (groqCfg.enabled && groqCfg.apiKey) {
      register(PROVIDER_NAMES.GROQ, {
        provider: PROVIDER_NAMES.GROQ,
        apiKey: groqCfg.apiKey,
        model: groqCfg.model,
      });
    }

    const ollamaCfg = this.configService.getOllamaConfig();
    if (ollamaCfg.enabled) {
      register(PROVIDER_NAMES.OLLAMA, {
        provider: PROVIDER_NAMES.OLLAMA,
        model: ollamaCfg.model,
        endpoint: ollamaCfg.endpoint,
      });
    }

    const anthropicCfg = this.configService.getAnthropicConfig();
    if (anthropicCfg.enabled && anthropicCfg.apiKey) {
      register(PROVIDER_NAMES.ANTHROPIC, {
        provider: PROVIDER_NAMES.ANTHROPIC,
        apiKey: anthropicCfg.apiKey,
        model: anthropicCfg.model,
      });
    }

    const openaiCfg = this.configService.getOpenAIConfig();
    if (openaiCfg.enabled && openaiCfg.apiKey) {
      register(PROVIDER_NAMES.OPENAI, {
        provider: PROVIDER_NAMES.OPENAI,
        apiKey: openaiCfg.apiKey,
        model: openaiCfg.model,
      });
    }

    return map;
  }
}