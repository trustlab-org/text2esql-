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
  GeminiProvider,
  GroqProvider,
  OllamaProvider,
  AnthropicProvider,
  OpenAIProvider,
} from './services';
import type { ILLMProvider } from './services';
import type { ProviderName } from '../common';
import { PROVIDER_NAMES } from '../common';
import { defineRoutes } from './routes';
import type {
  GeminiConfig,
  GroqConfig,
  OllamaConfig,
  AnthropicConfig,
  OpenAIConfig,
} from './services';

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

    // ── Plugin context ────────────────────────────────────────────────────────
    const pluginContext: QueryCopilotContext = {
      config: this.configService,
      logger: loggerService,
      metrics: metricsService,
      router: providerRouter,
    };

    // ── Routes ────────────────────────────────────────────────────────────────
    const router = core.http.createRouter();
    defineRoutes(router, pluginContext);

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
    if (this.healthMonitor) {
      this.healthMonitor.stop();
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Instantiates a provider for every enabled entry in config.
   * Disabled providers are skipped — the router only sees enabled ones.
   * Config validation has already run at this point (Kibana schema).
   */
  private buildProviderMap(): ReadonlyMap<ProviderName, ILLMProvider> {
    const map = new Map<ProviderName, ILLMProvider>();

    const geminiCfg = this.configService.getGeminiConfig();
    if (geminiCfg.enabled && geminiCfg.apiKey) {
      const cfg: GeminiConfig = {
        apiKey: geminiCfg.apiKey,
        model: geminiCfg.model,
        maxTokens: 8192,
        timeoutMs: 30_000,
        temperature: 0.2,
      };
      map.set(PROVIDER_NAMES.GEMINI, new GeminiProvider(cfg));
      this.logger.info('queryCopilot: registered Gemini provider');
    }

    const groqCfg = this.configService.getGroqConfig();
    if (groqCfg.enabled && groqCfg.apiKey) {
      const cfg: GroqConfig = {
        apiKey: groqCfg.apiKey,
        model: groqCfg.model,
        maxTokens: 8192,
        timeoutMs: 30_000,
        temperature: 0.2,
      };
      map.set(PROVIDER_NAMES.GROQ, new GroqProvider(cfg));
      this.logger.info('queryCopilot: registered Groq provider');
    }

    const ollamaCfg = this.configService.getOllamaConfig();
    if (ollamaCfg.enabled) {
      const cfg: OllamaConfig = {
        endpoint: ollamaCfg.endpoint,
        model: ollamaCfg.model,
        maxTokens: 4096,
        timeoutMs: 120_000,
        temperature: 0.2,
      };
      map.set(PROVIDER_NAMES.OLLAMA, new OllamaProvider(cfg));
      this.logger.info('queryCopilot: registered Ollama provider');
    }

    const anthropicCfg = this.configService.getAnthropicConfig();
    if (anthropicCfg.enabled && anthropicCfg.apiKey) {
      const cfg: AnthropicConfig = {
        apiKey: anthropicCfg.apiKey,
        model: anthropicCfg.model,
        maxTokens: 8192,
        timeoutMs: 60_000,
        temperature: 0.2,
        anthropicVersion: '2023-06-01',
      };
      map.set(PROVIDER_NAMES.ANTHROPIC, new AnthropicProvider(cfg));
      this.logger.info('queryCopilot: registered Anthropic provider');
    }

    const openaiCfg = this.configService.getOpenAIConfig();
    if (openaiCfg.enabled && openaiCfg.apiKey) {
      const cfg: OpenAIConfig = {
        apiKey: openaiCfg.apiKey,
        model: openaiCfg.model,
        maxTokens: 8192,
        timeoutMs: 60_000,
        temperature: 0.2,
      };
      map.set(PROVIDER_NAMES.OPENAI, new OpenAIProvider(cfg));
      this.logger.info('queryCopilot: registered OpenAI provider');
    }

    return map;
  }
}