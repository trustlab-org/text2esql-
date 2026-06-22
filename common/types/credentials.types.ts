import type { ProviderName } from './provider.types';

// ---------------------------------------------------------------------------
// ProviderCredential
//
// A single provider's per-request credential. Carried on the request body so a
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
// The credential bundle a single request carries: a mandatory primary provider
// and an optional fallback. The router tries primary first, then fallback.
// ---------------------------------------------------------------------------

export interface RequestCredentials {
  /** Tried first for every request. */
  readonly primary: ProviderCredential;
  /** Tried when the primary fails. Absent/null when no fallback is supplied. */
  readonly fallback?: ProviderCredential | null;
}

// ---------------------------------------------------------------------------
// Masked credential metadata
//
// Stage 3 moved raw keys to encrypted server-side storage. The browser now only
// ever handles MASKED metadata: provider/model/endpoint plus a `hasKey` boolean.
// Raw keys are never returned to the client. These structurally mirror the
// server's own copies in credentials.service.ts; they are the frontend-facing
// contract exported from common.
// ---------------------------------------------------------------------------

/** Masked metadata for a single provider slot. Never carries a raw key. */
export interface MaskedProvider {
  readonly provider: ProviderName;
  readonly model: string | null;
  readonly endpoint: string | null;
  readonly hasKey: boolean;
}

/** Masked status for the user's stored credentials (GET /credentials). */
export interface MaskedCredentials {
  readonly primary: MaskedProvider;
  readonly fallback: (MaskedProvider & { readonly enabled: boolean }) | null;
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
  readonly primary: SaveCredentialInput;
  readonly fallback?:
    | (SaveCredentialInput & { readonly enabled: boolean })
    | null;
}
