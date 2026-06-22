import { ProviderFactory } from './provider.factory';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import { OllamaProvider } from './ollama';
import { AnthropicProvider } from './anthropic';
import { OpenAIProvider } from './openai';
import { ProviderAuthError } from './errors';
import {
  PROVIDER_NAMES,
  PROVIDER_DEFAULT_MODELS,
  PROVIDER_CONTEXT_WINDOW_TOKENS,
} from '../../../common';
import type { ProviderName } from '../../../common';

// ---------------------------------------------------------------------------
// ProviderFactory unit tests.
//
// The concrete provider classes are mocked so we can capture the exact config
// object the factory constructs for each provider — this verifies both the
// dispatch (correct class) and the config shape (model defaulting, endpoint
// defaulting, the per-provider maxTokens/timeoutMs/temperature constants).
// ---------------------------------------------------------------------------

jest.mock('./gemini');
jest.mock('./groq');
jest.mock('./ollama');
jest.mock('./anthropic');
jest.mock('./openai');

const GeminiMock = GeminiProvider as jest.MockedClass<typeof GeminiProvider>;
const GroqMock = GroqProvider as jest.MockedClass<typeof GroqProvider>;
const OllamaMock = OllamaProvider as jest.MockedClass<typeof OllamaProvider>;
const AnthropicMock = AnthropicProvider as jest.MockedClass<typeof AnthropicProvider>;
const OpenAIMock = OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>;

describe('ProviderFactory.createProvider', () => {
  const factory = new ProviderFactory();

  beforeEach(() => jest.clearAllMocks());

  it('builds a GeminiProvider with the expected config shape', () => {
    factory.createProvider({ provider: PROVIDER_NAMES.GEMINI, apiKey: 'k', model: 'm' });
    expect(GeminiMock).toHaveBeenCalledWith({
      apiKey: 'k',
      model: 'm',
      maxTokens: 8192,
      timeoutMs: 30_000,
      temperature: 0.2,
    });
  });

  it('builds a GroqProvider with contextWindowTokens from constants', () => {
    factory.createProvider({ provider: PROVIDER_NAMES.GROQ, apiKey: 'k', model: 'm' });
    expect(GroqMock).toHaveBeenCalledWith({
      apiKey: 'k',
      model: 'm',
      maxTokens: 8192,
      contextWindowTokens: PROVIDER_CONTEXT_WINDOW_TOKENS.groq,
      timeoutMs: 30_000,
      temperature: 0.2,
    });
  });

  it('builds an OllamaProvider without an apiKey, defaulting the endpoint', () => {
    factory.createProvider({ provider: PROVIDER_NAMES.OLLAMA, model: 'm' });
    expect(OllamaMock).toHaveBeenCalledWith({
      endpoint: 'http://localhost:11434',
      model: 'm',
      maxTokens: 4096,
      timeoutMs: 120_000,
      temperature: 0.2,
    });
  });

  it('honours a custom ollama endpoint', () => {
    factory.createProvider({
      provider: PROVIDER_NAMES.OLLAMA,
      model: 'm',
      endpoint: 'http://ollama.internal:9999',
    });
    expect(OllamaMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://ollama.internal:9999' })
    );
  });

  it('builds an AnthropicProvider with the anthropicVersion header', () => {
    factory.createProvider({ provider: PROVIDER_NAMES.ANTHROPIC, apiKey: 'k', model: 'm' });
    expect(AnthropicMock).toHaveBeenCalledWith({
      apiKey: 'k',
      model: 'm',
      maxTokens: 8192,
      timeoutMs: 60_000,
      temperature: 0.2,
      anthropicVersion: '2023-06-01',
    });
  });

  it('builds an OpenAIProvider with the expected config shape', () => {
    factory.createProvider({ provider: PROVIDER_NAMES.OPENAI, apiKey: 'k', model: 'm' });
    expect(OpenAIMock).toHaveBeenCalledWith({
      apiKey: 'k',
      model: 'm',
      maxTokens: 8192,
      timeoutMs: 60_000,
      temperature: 0.2,
    });
  });

  it('defaults the model to PROVIDER_DEFAULT_MODELS when cred.model is absent', () => {
    factory.createProvider({ provider: PROVIDER_NAMES.OPENAI, apiKey: 'k' });
    expect(OpenAIMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: PROVIDER_DEFAULT_MODELS.openai })
    );

    factory.createProvider({ provider: PROVIDER_NAMES.OLLAMA });
    expect(OllamaMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: PROVIDER_DEFAULT_MODELS.ollama })
    );
  });

  it('throws ProviderAuthError when a non-ollama provider has no apiKey', () => {
    expect(() => factory.createProvider({ provider: PROVIDER_NAMES.OPENAI })).toThrow(
      ProviderAuthError
    );
    expect(OpenAIMock).not.toHaveBeenCalled();
  });

  it('throws ProviderAuthError when a non-ollama provider has an empty apiKey', () => {
    expect(() =>
      factory.createProvider({ provider: PROVIDER_NAMES.GEMINI, apiKey: '' })
    ).toThrow(ProviderAuthError);
  });

  it('the missing-key error never echoes a key value and names the provider', () => {
    try {
      factory.createProvider({ provider: PROVIDER_NAMES.ANTHROPIC });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderAuthError);
      const cause = (err as ProviderAuthError).cause as Error;
      expect(cause.message).toBe('No API key provided for anthropic');
    }
  });
});

describe('ProviderFactory.createProviderMap', () => {
  const factory = new ProviderFactory();

  beforeEach(() => jest.clearAllMocks());

  it('builds primary then fallback as two distinct entries', () => {
    const map = factory.createProviderMap({
      primary: { provider: PROVIDER_NAMES.OPENAI, apiKey: 'k1' },
      fallback: { provider: PROVIDER_NAMES.GEMINI, apiKey: 'k2' },
    });
    expect(map.size).toBe(2);
    expect(map.has(PROVIDER_NAMES.OPENAI as ProviderName)).toBe(true);
    expect(map.has(PROVIDER_NAMES.GEMINI as ProviderName)).toBe(true);
  });

  it('skips a null/absent fallback', () => {
    const map = factory.createProviderMap({
      primary: { provider: PROVIDER_NAMES.OPENAI, apiKey: 'k1' },
      fallback: null,
    });
    expect(map.size).toBe(1);
    expect(map.has(PROVIDER_NAMES.OPENAI as ProviderName)).toBe(true);
  });

  it('dedupes when primary and fallback name the same provider (fallback wins)', () => {
    const map = factory.createProviderMap({
      primary: { provider: PROVIDER_NAMES.OPENAI, apiKey: 'k1', model: 'gpt-4o' },
      fallback: { provider: PROVIDER_NAMES.OPENAI, apiKey: 'k2', model: 'gpt-4o-mini' },
    });
    expect(map.size).toBe(1);
    // Last write wins: the fallback's model is the one that constructed the
    // surviving provider instance.
    expect(OpenAIMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ apiKey: 'k2', model: 'gpt-4o-mini' })
    );
  });
});
