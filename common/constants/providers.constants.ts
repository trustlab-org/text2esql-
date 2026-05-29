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
  gemini: 'gemini-1.5-pro',
  groq: 'llama3-70b-8192',
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
