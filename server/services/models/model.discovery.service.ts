/**
 * Model discovery service for the Query Copilot plugin.
 *
 * Lists the chat-capable models AVAILABLE ON THE CALLER'S OWN ACCOUNT for each
 * supported provider, always fetched live from the provider (never a hardcoded
 * model list). Used by POST /api/query_copilot/models so the UI can offer an
 * accurate model picker per provider/key.
 *
 * This is a standalone service: it deliberately does NOT touch the ILLMProvider
 * abstraction or the query pipeline. API keys are used only to authenticate the
 * upstream call — they are NEVER logged and NEVER included in error messages.
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { PROVIDER_NAMES } from '../../../common';
import type { ProviderName, DiscoveredModel } from '../../../common/types';

/** How long any single upstream discovery call may take. */
const DISCOVERY_TIMEOUT_MS = 10_000;

/** Default local Ollama endpoint when neither the request nor storage has one. */
const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434';

/** Gemini v1beta REST base (mirrors gemini.provider.ts's listModels approach). */
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * OpenAI's /models endpoint returns every model on the account, most of which
 * cannot chat. We EXCLUDE obviously non-chat models by id substring rather than
 * allow-listing names, so newly released chat models appear automatically.
 */
const OPENAI_NON_CHAT_SUBSTRINGS = [
  'embedding',
  'whisper',
  'tts',
  'dall-e',
  'audio',
  'moderation',
  'realtime',
  'transcribe',
  'image',
  'davinci',
  'babbage',
] as const;

/** Credential input for one discovery call. The apiKey is NEVER logged. */
export interface ModelDiscoveryCredential {
  readonly provider: ProviderName;
  readonly apiKey?: string;
  readonly endpoint?: string;
}

/**
 * Normalised discovery failure. `statusCode` is safe to surface directly as the
 * HTTP status of the route response; `message` never contains key material.
 */
export class ModelDiscoveryError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ModelDiscoveryError';
    this.statusCode = statusCode;
  }
}

/**
 * Discovers the models available for a provider credential. One instance is
 * stateless and safe to share across requests.
 */
export class ModelDiscoveryService {
  /**
   * Lists the chat-capable models for `cred.provider`, sorted by id.
   * Throws {@link ModelDiscoveryError} on any upstream failure.
   */
  public async discoverModels(cred: ModelDiscoveryCredential): Promise<DiscoveredModel[]> {
    let models: DiscoveredModel[];

    switch (cred.provider) {
      case PROVIDER_NAMES.OPENAI:
        models = await this.discoverOpenAI(cred.apiKey, cred.endpoint);
        break;
      case PROVIDER_NAMES.ANTHROPIC:
        models = await this.discoverAnthropic(cred.apiKey);
        break;
      case PROVIDER_NAMES.GEMINI:
        models = await this.discoverGemini(cred.apiKey);
        break;
      case PROVIDER_NAMES.GROQ:
        models = await this.discoverGroq(cred.apiKey);
        break;
      case PROVIDER_NAMES.OLLAMA:
        models = await this.discoverOllama(cred.endpoint);
        break;
      default:
        throw new ModelDiscoveryError(400, 'Unsupported provider.');
    }

    return [...models].sort((a, b) => a.id.localeCompare(b.id));
  }

  // ---------------------------------------------------------------------------
  // Per-provider discovery
  // ---------------------------------------------------------------------------

  /**
   * OpenAI: SDK models.list(), excluding obviously non-chat model ids.
   * `endpoint` targets an OpenAI-COMPATIBLE server (vLLM/TGI/…) via baseURL;
   * undefined → the SDK's api.openai.com default.
   */
  private async discoverOpenAI(apiKey?: string, endpoint?: string): Promise<DiscoveredModel[]> {
    this.assertKey(apiKey);
    try {
      const client = new OpenAI({
        apiKey,
        timeout: DISCOVERY_TIMEOUT_MS,
        ...(endpoint ? { baseURL: endpoint } : {}),
      });
      const models: DiscoveredModel[] = [];
      for await (const model of client.models.list()) {
        const id = model.id;
        const lower = id.toLowerCase();
        if (OPENAI_NON_CHAT_SUBSTRINGS.some((s) => lower.includes(s))) {
          continue;
        }
        models.push({ id, displayName: id });
      }
      return models;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** Anthropic: SDK models.list() → { id, display_name }. */
  private async discoverAnthropic(apiKey?: string): Promise<DiscoveredModel[]> {
    this.assertKey(apiKey);
    try {
      const client = new Anthropic({ apiKey, timeout: DISCOVERY_TIMEOUT_MS });
      const page = await client.models.list();
      return page.data.map((model) => ({
        id: model.id,
        displayName: model.display_name ?? model.id,
      }));
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /**
   * Gemini: v1beta REST listModels (the legacy SDK exposes no listModels),
   * keeping only models that support generateContent and stripping the
   * "models/" prefix. The key travels ONLY in the URL — never in errors.
   */
  private async discoverGemini(apiKey?: string): Promise<DiscoveredModel[]> {
    this.assertKey(apiKey);

    let res: Response;
    let body: unknown;
    try {
      res = await fetch(`${GEMINI_API_BASE_URL}/models?key=${apiKey}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw this.errorForHttpStatus(res.status);
      }
      body = await res.json();
    } catch (error) {
      throw this.normalizeError(error);
    }

    return this.parseGeminiModels(body);
  }

  /** Groq: SDK models.list() → ids. */
  private async discoverGroq(apiKey?: string): Promise<DiscoveredModel[]> {
    this.assertKey(apiKey);
    try {
      const client = new Groq({ apiKey, timeout: DISCOVERY_TIMEOUT_MS });
      const result = await client.models.list();
      const models: DiscoveredModel[] = [];
      for (const model of result.data ?? []) {
        if (typeof model.id === 'string' && model.id.length > 0) {
          models.push({ id: model.id, displayName: model.id });
        }
      }
      return models;
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  /** Ollama: GET {endpoint}/api/tags → json.models[].name. No key needed. */
  private async discoverOllama(endpoint?: string): Promise<DiscoveredModel[]> {
    const base = (endpoint ?? OLLAMA_DEFAULT_ENDPOINT).replace(/\/+$/, '');

    let body: unknown;
    try {
      const res = await fetch(`${base}/api/tags`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw this.errorForHttpStatus(res.status);
      }
      body = await res.json();
    } catch (error) {
      throw this.normalizeError(error);
    }

    return this.parseOllamaModels(body);
  }

  // ---------------------------------------------------------------------------
  // Parsing helpers (defensive against unknown bodies — no `any`)
  // ---------------------------------------------------------------------------

  /** Extracts generateContent-capable models from the Gemini REST body. */
  private parseGeminiModels(body: unknown): DiscoveredModel[] {
    if (body === null || typeof body !== 'object' || !('models' in body)) {
      return [];
    }
    const entries = (body as { models?: unknown }).models;
    if (!Array.isArray(entries)) {
      return [];
    }

    const models: DiscoveredModel[] = [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') continue;
      const name = (entry as { name?: unknown }).name;
      const displayName = (entry as { displayName?: unknown }).displayName;
      const methods = (entry as { supportedGenerationMethods?: unknown })
        .supportedGenerationMethods;
      if (
        typeof name !== 'string' ||
        !Array.isArray(methods) ||
        !methods.includes('generateContent')
      ) {
        continue;
      }
      const id = name.startsWith('models/') ? name.slice('models/'.length) : name;
      models.push({
        id,
        displayName: typeof displayName === 'string' && displayName.length > 0 ? displayName : id,
      });
    }
    return models;
  }

  /** Extracts model names from the Ollama /api/tags body. */
  private parseOllamaModels(body: unknown): DiscoveredModel[] {
    if (body === null || typeof body !== 'object' || !('models' in body)) {
      return [];
    }
    const entries = (body as { models?: unknown }).models;
    if (!Array.isArray(entries)) {
      return [];
    }

    const models: DiscoveredModel[] = [];
    for (const entry of entries) {
      if (entry === null || typeof entry !== 'object') continue;
      const name = (entry as { name?: unknown }).name;
      if (typeof name === 'string' && name.length > 0) {
        models.push({ id: name, displayName: name });
      }
    }
    return models;
  }

  // ---------------------------------------------------------------------------
  // Error normalisation — messages NEVER include key material
  // ---------------------------------------------------------------------------

  /** Guards SDK paths that require a key (the route pre-validates; belt & braces). */
  private assertKey(apiKey: string | undefined): asserts apiKey is string {
    if (!apiKey) {
      throw new ModelDiscoveryError(
        400,
        'An API key is required to list models for this provider.'
      );
    }
  }

  /** Maps an upstream HTTP status to a normalised ModelDiscoveryError. */
  private errorForHttpStatus(status: number): ModelDiscoveryError {
    if (status === 401 || status === 403) {
      // Deliberately surfaced as 400, NOT 401/403: Kibana's browser HTTP
      // interceptor treats a 401 from any Kibana API as an expired Kibana
      // session and redirects the user to the login screen. A bad PROVIDER
      // key is a client error on this request, not a Kibana auth failure.
      return new ModelDiscoveryError(400, 'Invalid or unauthorized API key.');
    }
    if (status === 429) {
      return new ModelDiscoveryError(429, 'Provider rate limit exceeded — try again shortly.');
    }
    return new ModelDiscoveryError(502, 'Provider is unreachable.');
  }

  /**
   * Normalises any thrown value (SDK APIError, fetch abort, network failure)
   * into a {@link ModelDiscoveryError}. Already-normalised errors pass through.
   */
  private normalizeError(error: unknown): ModelDiscoveryError {
    if (error instanceof ModelDiscoveryError) {
      return error;
    }

    // Timeouts/aborts: AbortSignal.timeout throws DOMException('TimeoutError');
    // the SDKs throw *TimeoutError / *AbortError subclasses.
    if (error instanceof Error) {
      const name = error.name;
      if (name.includes('Timeout') || name.includes('Abort') || name === 'TimeoutError') {
        return new ModelDiscoveryError(504, 'Provider request timed out.');
      }

      // SDK API errors carry a numeric status/statusCode field.
      const status =
        (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
      if (typeof status === 'number') {
        return this.errorForHttpStatus(status);
      }
    }

    return new ModelDiscoveryError(502, 'Provider is unreachable.');
  }
}
