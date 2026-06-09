import { schema, type TypeOf } from '@kbn/config-schema';
import { DEFAULT_INDEX_PATTERN, PROVIDER_DEFAULT_MODELS } from '../common';

export const configSchema = schema.object({
  // ── Top-level ────────────────────────────────────────────────────────────
  enabled: schema.boolean({ defaultValue: true }),

  // Default Elasticsearch index pattern. Exposed to the browser (see
  // server/index.ts) so the client can seed its initial state. Defaults to a
  // scoped pattern rather than `*` to avoid matching noise indices.
  defaultIndexPattern: schema.string({ defaultValue: DEFAULT_INDEX_PATTERN, minLength: 1 }),

  // ── Redis (response cache backing store) ─────────────────────────────────
  redis: schema.object({
    host: schema.string({ defaultValue: 'localhost' }),
    port: schema.number({
      defaultValue: 6379,
      validate(value) {
        if (value < 1 || value > 65535) {
          return `redis.port must be between 1 and 65535, got ${value}`;
        }
      },
    }),
    ttl: schema.number({
      defaultValue: 300,
      validate(value) {
        if (value < 1 || value > 86400) {
          return `redis.ttl must be between 1 and 86400 seconds, got ${value}`;
        }
      },
    }),
  }),

  // ── LLM Providers ────────────────────────────────────────────────────────
  providers: schema.object({
    gemini: schema.object({
      enabled: schema.boolean({ defaultValue: false }),
      apiKey: schema.maybe(schema.string({ minLength: 1 })),
      model: schema.string({ defaultValue: PROVIDER_DEFAULT_MODELS.gemini }),
    }),

    groq: schema.object({
      enabled: schema.boolean({ defaultValue: false }),
      apiKey: schema.maybe(schema.string({ minLength: 1 })),
      model: schema.string({ defaultValue: PROVIDER_DEFAULT_MODELS.groq }),
    }),

    ollama: schema.object({
      enabled: schema.boolean({ defaultValue: false }),
      endpoint: schema.uri({ defaultValue: 'http://localhost:11434' }),
      model: schema.string({ defaultValue: PROVIDER_DEFAULT_MODELS.ollama }),
    }),

    anthropic: schema.object({
      enabled: schema.boolean({ defaultValue: false }),
      apiKey: schema.maybe(schema.string({ minLength: 1 })),
      model: schema.string({ defaultValue: PROVIDER_DEFAULT_MODELS.anthropic }),
    }),

    openai: schema.object({
      enabled: schema.boolean({ defaultValue: false }),
      apiKey: schema.maybe(schema.string({ minLength: 1 })),
      model: schema.string({ defaultValue: PROVIDER_DEFAULT_MODELS.openai }),
    }),
  }),

  // ── Pipeline ─────────────────────────────────────────────────────────────
  pipeline: schema.object({
    maxCorrectionRetries: schema.number({
      defaultValue: 2,
      validate(value) {
        if (!Number.isInteger(value) || value < 0 || value > 5) {
          return `pipeline.maxCorrectionRetries must be an integer between 0 and 5, got ${value}`;
        }
      },
    }),
    queryTimeoutMs: schema.number({
      defaultValue: 30000,
      validate(value) {
        if (value < 5000 || value > 120000) {
          return `pipeline.queryTimeoutMs must be between 5000 and 120000 ms, got ${value}`;
        }
      },
    }),
    cacheEnabled: schema.boolean({ defaultValue: true }),
  }),

  // ── MCP (Elasticsearch MCP Server client) ────────────────────────────────
  mcp: schema.object({
    serverUrl: schema.string({ defaultValue: 'http://localhost:8080/mcp' }),
    requestTimeoutMs: schema.number({
      defaultValue: 30000,
      validate(value) {
        if (value < 1000 || value > 120000) {
          return `mcp.requestTimeoutMs must be between 1000 and 120000 ms, got ${value}`;
        }
      },
    }),
  }),
});

export type QueryCopilotConfig = TypeOf<typeof configSchema>;

export type GeminiProviderConfig = QueryCopilotConfig['providers']['gemini'];
export type GroqProviderConfig = QueryCopilotConfig['providers']['groq'];
export type OllamaProviderConfig = QueryCopilotConfig['providers']['ollama'];
export type AnthropicProviderConfig = QueryCopilotConfig['providers']['anthropic'];
export type OpenAIProviderConfig = QueryCopilotConfig['providers']['openai'];
export type RedisConfig = QueryCopilotConfig['redis'];
export type PipelineConfig = QueryCopilotConfig['pipeline'];
export type McpConfig = QueryCopilotConfig['mcp'];

/**
 * MUST match the snake_case conversion of the plugin id in kibana.json.
 * kibana.json id: "queryCopilot" → Kibana config namespace: "query_copilot"
 */
export const CONFIG_PATH = 'query_copilot' as const;