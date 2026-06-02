export const PROVIDER_NAMES = {
  GEMINI: 'gemini',
  GROQ: 'groq',
  OLLAMA: 'ollama',
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
} as const;

export const ALL_PROVIDER_NAMES = Object.values(PROVIDER_NAMES);

export const PROVIDER_DISPLAY_NAMES: Record<
  (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES],
  string
> = {
  gemini: 'Google Gemini',
  groq: 'Groq',
  ollama: 'Ollama (Local)',
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
} as const;

export const PROVIDER_DEFAULT_MODELS: Record<
  (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES],
  string
> = {
  // gemini-1.5-* retired from v1beta generateContent (404); 2.0-flash is the current GA default. Operators can override via query_copilot.providers.gemini.model; startup validation logs the models actually available to the configured key.
  gemini: 'gemini-2.0-flash',
  // llama3-70b-8192 decommissioned by Groq; llama-3.3-70b-versatile is the current GA default. Override via query_copilot.providers.groq.model.
  groq: 'llama-3.3-70b-versatile',
  ollama: 'llama3',
  anthropic: 'claude-3-5-sonnet-20241022',
  openai: 'gpt-4o',
} as const;

export const PROVIDER_MAX_TOKENS: Record<
  (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES],
  number
> = {
  gemini: 8192,
  groq: 8192,
  ollama: 4096,
  anthropic: 8192,
  openai: 8192,
} as const;

export const PROVIDER_SUPPORTS_STREAMING: Record<
  (typeof PROVIDER_NAMES)[keyof typeof PROVIDER_NAMES],
  boolean
> = {
  gemini: true,
  groq: true,
  ollama: true,
  anthropic: true,
  openai: true,
} as const;
