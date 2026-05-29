import { z } from 'zod';
import {
  ProviderNameSchema,
  HealthStatusSchema,
  ProviderFinishReasonSchema,
  ISODateTimeSchema,
} from './primitives.schema';
import type {
  ProviderMetadata,
  ProviderCapabilities,
  ProviderHealthStatus,
  ProviderResponse,
  ProviderTokenUsage,
  ProviderRequestConfig,
} from '../types';
import { PIPELINE_CONFIG } from '../constants';

// ---------------------------------------------------------------------------
// ProviderCapabilities
// ---------------------------------------------------------------------------
export const ProviderCapabilitiesSchema: z.ZodType<ProviderCapabilities> = z.object({
  streaming: z.boolean(),
  functionCalling: z.boolean(),
  jsonMode: z.boolean(),
  vision: z.boolean(),
  codeInterpreter: z.boolean(),
});

// ---------------------------------------------------------------------------
// ProviderMetadata
// ---------------------------------------------------------------------------
export const ProviderMetadataSchema: z.ZodType<ProviderMetadata> = z.object({
  name: ProviderNameSchema,
  displayName: z.string().min(1),
  model: z.string().min(1),
  supportsStreaming: z.boolean(),
  maxTokens: z.number().int().positive(),
  baseUrl: z.string().url().optional(),
  apiVersion: z.string().optional(),
  capabilities: ProviderCapabilitiesSchema,
});

// ---------------------------------------------------------------------------
// ProviderHealthStatus
// ---------------------------------------------------------------------------
export const ProviderHealthStatusSchema: z.ZodType<ProviderHealthStatus> = z.object({
  provider: ProviderNameSchema,
  status: HealthStatusSchema,
  latencyMs: z.number().nonnegative().nullable(),
  lastCheckedAt: ISODateTimeSchema,
  errorMessage: z.string().nullable(),
  consecutiveFailures: z.number().int().nonnegative(),
  modelAvailable: z.boolean(),
});

// ---------------------------------------------------------------------------
// ProviderTokenUsage
// ---------------------------------------------------------------------------
export const ProviderTokenUsageSchema: z.ZodType<ProviderTokenUsage> = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// ProviderResponse
// ---------------------------------------------------------------------------
export const ProviderResponseSchema: z.ZodType<ProviderResponse> = z.object({
  provider: ProviderNameSchema,
  model: z.string().min(1),
  content: z.string(),
  finishReason: ProviderFinishReasonSchema,
  usage: ProviderTokenUsageSchema,
  latencyMs: z.number().nonnegative(),
  requestId: z.string().nullable(),
  cached: z.boolean(),
  raw: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// ProviderRequestConfig
// ---------------------------------------------------------------------------
export const ProviderRequestConfigSchema: z.ZodType<ProviderRequestConfig> = z.object({
  provider: ProviderNameSchema,
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z
    .number()
    .int()
    .positive()
    .max(PIPELINE_CONFIG.MAX_TOKENS_DEFAULT * 4)
    .optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  stream: z.boolean().optional(),
  systemPrompt: z.string().max(4000).optional(),
});

// ---------------------------------------------------------------------------
// ProviderConfigSchema — per-provider runtime configuration (API keys, etc.)
// This is NOT in common/types (it's sensitive config, not a domain type).
// It lives here as the authoritative runtime validation contract.
// ---------------------------------------------------------------------------
export const SingleProviderConfigSchema = z.object({
  enabled: z.boolean(),
  apiKey: z.string().min(1).optional(),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  maxTokens: z.number().int().positive().max(32_768).default(4096),
  temperature: z.number().min(0).max(2).default(0.2),
  apiVersion: z.string().optional(),
  stream: z.boolean().default(true),
});

export const ProviderConfigSchema = z.object({
  gemini: SingleProviderConfigSchema.extend({
    apiKey: z.string().min(1, 'Gemini API key is required'),
    projectId: z.string().optional(),
    location: z.string().optional(),
  }),
  groq: SingleProviderConfigSchema.extend({
    apiKey: z.string().min(1, 'Groq API key is required'),
  }),
  ollama: SingleProviderConfigSchema.extend({
    baseUrl: z.string().url('Ollama base URL is required').default('http://localhost:11434'),
    // Ollama is local — no API key
    apiKey: z.undefined().optional(),
  }),
  anthropic: SingleProviderConfigSchema.extend({
    apiKey: z.string().min(1, 'Anthropic API key is required'),
    anthropicVersion: z.string().default('2023-06-01'),
  }),
  openai: SingleProviderConfigSchema.extend({
    apiKey: z.string().min(1, 'OpenAI API key is required'),
    organization: z.string().optional(),
    project: z.string().optional(),
  }),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type SingleProviderConfig = z.infer<typeof SingleProviderConfigSchema>;

// ---------------------------------------------------------------------------
// Inferred cross-check types
// ---------------------------------------------------------------------------
export type ProviderCapabilitiesSchemaType = z.infer<typeof ProviderCapabilitiesSchema>;
export type ProviderMetadataSchemaType = z.infer<typeof ProviderMetadataSchema>;
export type ProviderHealthStatusSchemaType = z.infer<typeof ProviderHealthStatusSchema>;
export type ProviderResponseSchemaType = z.infer<typeof ProviderResponseSchema>;
export type ProviderRequestConfigSchemaType = z.infer<typeof ProviderRequestConfigSchema>;
