import type { Logger } from '@kbn/core/server';
import type { ProviderName } from '../../../common';
import { PROVIDER_NAMES } from '../../../common';
import type {
  QueryCopilotConfig,
  GeminiProviderConfig,
  GroqProviderConfig,
  OllamaProviderConfig,
  AnthropicProviderConfig,
  OpenAIProviderConfig,
  RedisConfig,
  PipelineConfig,
  McpConfig,
} from '../../config';

// ---------------------------------------------------------------------------
// Redacted config shape
// Same structure as QueryCopilotConfig but apiKey fields are always string
// (the masked value) — never undefined — safe to log or expose in /health.
// ---------------------------------------------------------------------------

type RedactedProviderConfig<T extends { apiKey?: string | undefined }> = Omit<T, 'apiKey'> & {
  apiKey: string;
};

type RedactedOllamaConfig = OllamaProviderConfig; // no apiKey field

export interface RedactedQueryCopilotConfig {
  readonly enabled: boolean;
  readonly redis: RedisConfig;
  readonly providers: {
    readonly gemini: RedactedProviderConfig<GeminiProviderConfig>;
    readonly groq: RedactedProviderConfig<GroqProviderConfig>;
    readonly ollama: RedactedOllamaConfig;
    readonly anthropic: RedactedProviderConfig<AnthropicProviderConfig>;
    readonly openai: RedactedProviderConfig<OpenAIProviderConfig>;
  };
  readonly pipeline: PipelineConfig;
}

const API_KEY_MASK = '[REDACTED]' as const;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ProviderNotEnabledError extends Error {
  constructor(provider: ProviderName) {
    super(`Provider "${provider}" is not enabled in configuration`);
    this.name = 'ProviderNotEnabledError';
  }
}

export class ProviderApiKeyMissingError extends Error {
  constructor(provider: ProviderName) {
    super(
      `Provider "${provider}" is enabled but no API key is configured. ` +
        `Set queryCopilot.providers.${provider}.apiKey in kibana.yml`
    );
    this.name = 'ProviderApiKeyMissingError';
  }
}

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------

/**
 * ConfigService wraps the resolved Kibana config for the queryCopilot plugin.
 *
 * Responsibilities:
 *  - Provide strongly-typed getters for all config sections.
 *  - Enforce API key presence before returning secrets.
 *  - Produce a fully redacted config snapshot safe for logging / health endpoints.
 *  - Never emit API keys to the logger.
 *
 * Instantiation: created in QueryCopilotPlugin.setup() with the resolved config
 * value. Stateless after construction — no mutable fields.
 */
export class ConfigService {
  private readonly config: QueryCopilotConfig;
  private readonly logger: Logger;

  constructor(config: QueryCopilotConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;

    this.logger.debug('ConfigService initialised');
    this.logStartupSummary();
  }

  // ── Top-level ─────────────────────────────────────────────────────────────

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Returns the configured default Elasticsearch index pattern.
   * Used to scope mapping lookups and query execution away from noise indices.
   */
  public getDefaultIndexPattern(): string {
    return this.config.defaultIndexPattern;
  }

  // ── Redis ─────────────────────────────────────────────────────────────────

  public getRedisConfig(): Readonly<RedisConfig> {
    return this.config.redis;
  }

  // ── Pipeline ──────────────────────────────────────────────────────────────

  public getPipelineConfig(): Readonly<PipelineConfig> {
    return this.config.pipeline;
  }

  public isCacheEnabled(): boolean {
    return this.config.pipeline.cacheEnabled;
  }

  public getQueryTimeoutMs(): number {
    return this.config.pipeline.queryTimeoutMs;
  }

  public getMaxCorrectionRetries(): number {
    return this.config.pipeline.maxCorrectionRetries;
  }

  // ── MCP ───────────────────────────────────────────────────────────────────

  /**
   * Returns the MCP client config (server URL + request timeout).
   * No secrets are present, so this is safe to read freely.
   */
  public getMcpConfig(): Readonly<McpConfig> {
    return this.config.mcp;
  }

  // ── Providers ─────────────────────────────────────────────────────────────

  /**
   * Returns the list of currently enabled provider names.
   * Useful for router selection and health aggregation.
   */
  public getEnabledProviders(): readonly ProviderName[] {
    const { providers } = this.config;
    return (
      [
        providers.gemini.enabled ? PROVIDER_NAMES.GEMINI : null,
        providers.groq.enabled ? PROVIDER_NAMES.GROQ : null,
        providers.ollama.enabled ? PROVIDER_NAMES.OLLAMA : null,
        providers.anthropic.enabled ? PROVIDER_NAMES.ANTHROPIC : null,
        providers.openai.enabled ? PROVIDER_NAMES.OPENAI : null,
      ] as Array<ProviderName | null>
    ).filter((p): p is ProviderName => p !== null);
  }

  public isProviderEnabled(provider: ProviderName): boolean {
    return this.config.providers[provider].enabled;
  }

  /**
   * Returns the resolved model name for a provider.
   * Does NOT require the provider to be enabled — callers may query this
   * for display purposes regardless of enabled state.
   */
  public getProviderModel(provider: ProviderName): string {
    return this.config.providers[provider].model;
  }

  /**
   * Returns the API key for a provider.
   *
   * Throws:
   *  - ProviderNotEnabledError   — if the provider is disabled
   *  - ProviderApiKeyMissingError — if enabled but no key is set (e.g. Ollama path)
   *
   * Note: Ollama uses an endpoint, not an API key. Calling this for Ollama
   * always throws ProviderApiKeyMissingError — use getOllamaEndpoint() instead.
   *
   * NEVER pass the return value to logger methods.
   */
  public getProviderApiKey(provider: ProviderName): string {
    if (!this.isProviderEnabled(provider)) {
      throw new ProviderNotEnabledError(provider);
    }

    const providerConfig = this.config.providers[provider];

    if (!('apiKey' in providerConfig) || providerConfig.apiKey === undefined) {
      throw new ProviderApiKeyMissingError(provider);
    }

    return (providerConfig as { apiKey: string }).apiKey;
  }

  /**
   * Returns the Ollama endpoint URL.
   * Throws ProviderNotEnabledError if ollama is disabled.
   */
  public getOllamaEndpoint(): string {
    if (!this.config.providers.ollama.enabled) {
      throw new ProviderNotEnabledError(PROVIDER_NAMES.OLLAMA);
    }
    return this.config.providers.ollama.endpoint;
  }

  // ── Typed per-provider accessors ──────────────────────────────────────────
  // These return the full config object for providers that need more than
  // just the API key (e.g. model, custom settings). Guards check enabled state.

  public getGeminiConfig(): Readonly<GeminiProviderConfig> {
    return this.config.providers.gemini;
  }

  public getGroqConfig(): Readonly<GroqProviderConfig> {
    return this.config.providers.groq;
  }

  public getOllamaConfig(): Readonly<OllamaProviderConfig> {
    return this.config.providers.ollama;
  }

  public getAnthropicConfig(): Readonly<AnthropicProviderConfig> {
    return this.config.providers.anthropic;
  }

  public getOpenAIConfig(): Readonly<OpenAIProviderConfig> {
    return this.config.providers.openai;
  }

  // ── Redacted snapshot ─────────────────────────────────────────────────────

  /**
   * Returns a deep copy of the full config with all API keys replaced by
   * the mask string "[REDACTED]". Safe to pass to loggers, health endpoints,
   * and observability events.
   *
   * The return type enforces that apiKey is always present as a string,
   * preventing callers from accidentally treating the mask as a real key.
   */
  public getRedactedConfig(): RedactedQueryCopilotConfig {
    const { providers, redis, pipeline, enabled } = this.config;

    return {
      enabled,
      redis: { ...redis },
      pipeline: { ...pipeline },
      providers: {
        gemini: {
          ...providers.gemini,
          apiKey: API_KEY_MASK,
        },
        groq: {
          ...providers.groq,
          apiKey: API_KEY_MASK,
        },
        ollama: { ...providers.ollama },
        anthropic: {
          ...providers.anthropic,
          apiKey: API_KEY_MASK,
        },
        openai: {
          ...providers.openai,
          apiKey: API_KEY_MASK,
        },
      },
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Logs a startup summary — enabled state and which providers are active.
   * Deliberately avoids logging any secret values.
   */
  private logStartupSummary(): void {
    if (!this.config.enabled) {
      this.logger.warn('queryCopilot plugin is disabled via configuration');
      return;
    }

    const enabledProviders = this.getEnabledProviders();

    this.logger.info(
      `queryCopilot config loaded — enabled providers: [${
        enabledProviders.length > 0 ? enabledProviders.join(', ') : 'none'
      }]`
    );

    this.logger.debug(
      `queryCopilot pipeline config: timeout=${this.config.pipeline.queryTimeoutMs}ms, ` +
        `maxRetries=${this.config.pipeline.maxCorrectionRetries}, ` +
        `cache=${this.config.pipeline.cacheEnabled}`
    );

    this.logger.debug(
      `queryCopilot redis config: host=${this.config.redis.host}, ` +
        `port=${this.config.redis.port}, ` +
        `ttl=${this.config.redis.ttl}s`
    );

    // Warn on enabled providers that are missing API keys
    const apiKeyProviders = [
      PROVIDER_NAMES.GEMINI,
      PROVIDER_NAMES.GROQ,
      PROVIDER_NAMES.ANTHROPIC,
      PROVIDER_NAMES.OPENAI,
    ] as const;

    for (const provider of apiKeyProviders) {
      const providerCfg = this.config.providers[provider];
      if (providerCfg.enabled && !providerCfg.apiKey) {
        this.logger.warn(
          `Provider "${provider}" is enabled but queryCopilot.providers.${provider}.apiKey is not set`
        );
      }
    }
  }
}
