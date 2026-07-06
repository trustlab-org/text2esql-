import type { ProviderName } from './provider.types';

// ---------------------------------------------------------------------------
// ProviderCredential
//
// A single provider's per-request credential. Carried on the request chain so a
// provider can be built PER REQUEST from the caller's own key rather than the
// boot-time kibana.yml config. The apiKey is NEVER written to kibana.yml and
// NEVER logged.
// ---------------------------------------------------------------------------

export interface ProviderCredential {
  /** Which provider this credential is for. */
  readonly provider: ProviderName;
  /**
   * The caller's API key. Optional because Ollama runs locally and needs none;
   * for every other provider it is required and validated by the factory.
   * Never logged.
   */
  readonly apiKey?: string;
  /** Optional model override; falls back to PROVIDER_DEFAULT_MODELS[provider]. */
  readonly model?: string;
  /** Optional endpoint override; currently only honoured by Ollama. */
  readonly endpoint?: string;
}

// ---------------------------------------------------------------------------
// RequestCredentials
//
// The credential bundle a single request carries: an ORDERED list of provider
// credentials. The router tries them in order (index 0 first) and falls through
// on failure. The list holds at most one entry per provider. The caller's
// selected provider (if any) is hoisted to the front before routing.
// ---------------------------------------------------------------------------

export interface RequestCredentials {
  /**
   * Ordered provider credentials to try (index 0 first). Always non-empty for a
   * usable bundle. At most one entry per provider.
   */
  readonly providers: readonly ProviderCredential[];
}

// ---------------------------------------------------------------------------
// Masked credential metadata
//
// The browser only ever handles MASKED metadata: provider/model/endpoint plus a
// `hasKey` boolean. Raw keys are never returned to the client. These are the
// frontend-facing contract exported from common.
// ---------------------------------------------------------------------------

/** Masked metadata for a single configured provider slot. Never carries a raw key. */
export interface MaskedProvider {
  readonly provider: ProviderName;
  readonly model: string | null;
  readonly endpoint: string | null;
  readonly hasKey: boolean;
}

/**
 * Masked status for the user's stored credentials (GET /credentials).
 *
 * Lists every configured provider slot (0..5, one per provider) and names which
 * provider is the default primary (tried first when the user has not pinned a
 * different one via the main-screen selector).
 */
export interface MaskedCredentials {
  /** Every configured provider slot, in the user's saved order. */
  readonly providers: readonly MaskedProvider[];
  /** The default primary provider, or null when nothing is configured. */
  readonly primaryProvider: ProviderName | null;
}

/** Per-provider input for one slot of a save request. */
export interface SaveCredentialInput {
  readonly provider: ProviderName;
  readonly model?: string;
  readonly endpoint?: string;
  /** Omit/empty to PRESERVE the existing encrypted key on update. Never logged. */
  readonly apiKey?: string;
}

/** Body for POST /credentials. */
export interface SaveCredentialsInput {
  /** The full set of provider slots to persist (at most one per provider). */
  readonly providers: readonly SaveCredentialInput[];
  /**
   * Which provider is the default primary (tried first). Defaults to
   * `providers[0]` when omitted or when the named provider is not in the list.
   */
  readonly primaryProvider?: ProviderName;
}
