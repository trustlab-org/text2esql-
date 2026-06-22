import type { ProviderCredential, RequestCredentials } from '../../common/types';
import { ALL_PROVIDER_NAMES, PROVIDER_NAMES } from '../../common';

/**
 * Browser-side persistence for the user's own LLM credentials.
 *
 * Credentials are stored ONLY in `window.localStorage` (never in kibana.yml and
 * never sent anywhere except as the per-request `credentials` field on a generate
 * call). All access is wrapped in try/catch so the module is safe in private
 * browsing modes where localStorage access throws. API keys are NEVER logged.
 */

/** localStorage key under which the {@link RequestCredentials} bundle is stored. */
export const CREDENTIALS_STORAGE_KEY = 'queryCopilot.providerCredentials';

/** True when `value` is a non-empty string. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Shape-validates a parsed object into a {@link ProviderCredential}, or returns
 * null when the provider field is missing/unknown. Optional fields are coerced
 * to strings only when present.
 */
function parseProviderCredential(value: unknown): ProviderCredential | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  if (typeof provider !== 'string' || !ALL_PROVIDER_NAMES.includes(provider as never)) {
    return null;
  }
  const result: { -readonly [K in keyof ProviderCredential]: ProviderCredential[K] } = {
    provider: provider as ProviderCredential['provider'],
  };
  if (isNonEmptyString(candidate.apiKey)) {
    result.apiKey = candidate.apiKey;
  }
  if (isNonEmptyString(candidate.model)) {
    result.model = candidate.model;
  }
  if (isNonEmptyString(candidate.endpoint)) {
    result.endpoint = candidate.endpoint;
  }
  return result;
}

/**
 * Reads and shape-validates the persisted credentials. Returns null when nothing
 * is stored, when the JSON is corrupt, or when the shape is invalid (e.g. an
 * unknown provider or a missing primary).
 */
export function loadCredentials(): RequestCredentials | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CREDENTIALS_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const candidate = parsed as Record<string, unknown>;
  const primary = parseProviderCredential(candidate.primary);
  if (primary === null) {
    return null;
  }

  const fallback = parseProviderCredential(candidate.fallback);
  return fallback === null ? { primary } : { primary, fallback };
}

/**
 * Persists the credentials bundle. Silently no-ops if localStorage is
 * unavailable (private mode). Never logs the key on success or failure.
 */
export function saveCredentials(creds: RequestCredentials): void {
  try {
    window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, JSON.stringify(creds));
  } catch {
    // Storage unavailable (private mode / quota). Intentionally swallowed so the
    // UI doesn't crash; the in-memory React state still reflects the change for
    // the lifetime of the session.
  }
}

/** Removes any persisted credentials. Safe when storage is unavailable. */
export function clearCredentials(): void {
  try {
    window.localStorage.removeItem(CREDENTIALS_STORAGE_KEY);
  } catch {
    // Intentionally swallowed (see saveCredentials).
  }
}

/**
 * True when `creds` has a usable primary provider: the provider is set AND
 * either an API key is present, or the provider is Ollama (which runs locally
 * and needs no key).
 */
export function hasUsablePrimary(creds: RequestCredentials | null): boolean {
  if (creds === null) {
    return false;
  }
  const { primary } = creds;
  if (primary === null || typeof primary !== 'object') {
    return false;
  }
  if (typeof primary.provider !== 'string') {
    return false;
  }
  if (primary.provider === PROVIDER_NAMES.OLLAMA) {
    return true;
  }
  return isNonEmptyString(primary.apiKey);
}
