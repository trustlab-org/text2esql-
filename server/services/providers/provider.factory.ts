import type { ProviderName } from '../../../common';
import {
  PROVIDER_NAMES,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_CONTEXT_WINDOW_TOKENS,
} from '../../../common';
import type { ProviderCredential, RequestCredentials } from '../../../common/types';
import type { ILLMProvider } from './types';
import { ProviderAuthError } from './errors';
import { GeminiProvider, type GeminiConfig } from './gemini';
import { GroqProvider, type GroqConfig } from './groq';
import { OllamaProvider, type OllamaConfig } from './ollama';
import { AnthropicProvider, type AnthropicConfig } from './anthropic';
import { OpenAIProvider, type OpenAIConfig } from './openai';

// ---------------------------------------------------------------------------
// Default Ollama endpoint
//
// Mirrors OLLAMA_DEFAULTS.endpoint (and the boot-time config default) so a
// per-request credential that omits an endpoint targets the same local server
// as a kibana.yml-configured Ollama provider.
// ---------------------------------------------------------------------------

const OLLAMA_DEFAULT_ENDPOINT = 'http://localhost:11434';

// ---------------------------------------------------------------------------
// ProviderFactory
//
// Builds concrete ILLMProvider instances from a per-request ProviderCredential.
// The construction logic — the maxTokens/timeoutMs/temperature/etc. constants
// for each provider — is the single source of truth, mirroring the shapes that
// used to be inlined in QueryCopilotPlugin.buildProviderMap. The plugin now
// delegates here for both boot-time and per-request provider construction so
// the two paths can never drift apart.
//
// API keys are NEVER logged: this factory does not log at all, and the error it
// throws for a missing key (ProviderAuthError) never echoes any key value.
// ---------------------------------------------------------------------------

export class ProviderFactory {
  /**
   * Builds a single concrete provider from one credential.
   *
   * `cred.model` defaults to PROVIDER_DEFAULT_MODELS[provider] when absent.
   * Ollama uses `cred.endpoint` (defaulting to the local server) and needs no
   * apiKey; every other provider requires a non-empty apiKey or a
   * {@link ProviderAuthError} is thrown.
   */
  public createProvider(cred: ProviderCredential): ILLMProvider {
    const model = cred.model ?? PROVIDER_DEFAULT_MODELS[cred.provider];

    switch (cred.provider) {
      case PROVIDER_NAMES.GEMINI: {
        const apiKey = this.requireApiKey(cred);
        const cfg: GeminiConfig = {
          apiKey,
          model,
          maxTokens: 8192,
          timeoutMs: 30_000,
          temperature: 0.2,
        };
        return new GeminiProvider(cfg);
      }

      case PROVIDER_NAMES.GROQ: {
        const apiKey = this.requireApiKey(cred);
        const cfg: GroqConfig = {
          apiKey,
          model,
          maxTokens: 8192,
          contextWindowTokens: PROVIDER_CONTEXT_WINDOW_TOKENS.groq,
          timeoutMs: 30_000,
          temperature: 0.2,
        };
        return new GroqProvider(cfg);
      }

      case PROVIDER_NAMES.OLLAMA: {
        const cfg: OllamaConfig = {
          endpoint: cred.endpoint ?? OLLAMA_DEFAULT_ENDPOINT,
          model,
          maxTokens: 4096,
          timeoutMs: 120_000,
          temperature: 0.2,
        };
        return new OllamaProvider(cfg);
      }

      case PROVIDER_NAMES.ANTHROPIC: {
        const apiKey = this.requireApiKey(cred);
        const cfg: AnthropicConfig = {
          apiKey,
          model,
          maxTokens: 8192,
          timeoutMs: 60_000,
          temperature: 0.2,
          anthropicVersion: '2023-06-01',
        };
        return new AnthropicProvider(cfg);
      }

      case PROVIDER_NAMES.OPENAI: {
        const apiKey = this.requireApiKey(cred);
        const cfg: OpenAIConfig = {
          apiKey,
          model,
          maxTokens: 8192,
          timeoutMs: 60_000,
          temperature: 0.2,
          // Honour a custom endpoint so OpenAI-compatible servers (vLLM/TGI/…)
          // can be targeted. Undefined → the SDK's default api.openai.com.
          ...(cred.endpoint ? { baseURL: cred.endpoint } : {}),
        };
        return new OpenAIProvider(cfg);
      }

      default: {
        // Exhaustiveness guard — ProviderName is a closed union, so this is
        // only reachable if a new provider is added without a branch here.
        const exhaustive: never = cred.provider;
        throw new Error(`Unknown provider: ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Builds the per-request provider map from the ordered credential list: one
   * concrete {@link ILLMProvider} per entry, keyed by provider name. Map.set
   * dedupes by key, so a duplicate provider in the list keeps a single entry
   * (last write wins). The map is unordered; routing order is derived separately
   * from the list in {@link buildRequestRouter}.
   */
  public createProviderMap(creds: RequestCredentials): Map<ProviderName, ILLMProvider> {
    const map = new Map<ProviderName, ILLMProvider>();

    for (const cred of creds.providers) {
      map.set(cred.provider, this.createProvider(cred));
    }

    return map;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Returns the credential's apiKey or throws a {@link ProviderAuthError} when
   * it is missing/empty. The thrown error never includes the key value.
   */
  private requireApiKey(cred: ProviderCredential): string {
    if (!cred.apiKey) {
      throw new ProviderAuthError(cred.provider, {
        cause: new Error(`No API key provided for ${cred.provider}`),
      });
    }
    return cred.apiKey;
  }
}
