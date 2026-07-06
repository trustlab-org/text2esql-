import type { SavedObjectsType } from '@kbn/core/server';
import type { ProviderName } from '../../common';

// ---------------------------------------------------------------------------
// query-copilot-credentials saved object
//
// Stores a single user's LLM provider credentials server-side. The two apiKey
// attributes are encrypted at rest by the encryptedSavedObjects plugin (see the
// registerType call in plugin.ts) and are NEVER returned to the browser or
// logged. The SO is `hidden` (only reachable via an explicit
// includedHiddenTypes scoped client) and `agnostic` (one record per user,
// independent of spaces).
// ---------------------------------------------------------------------------

/** Saved object type name + the ESO registration key. */
export const CREDENTIALS_SO_TYPE = 'query-copilot-credentials';

/**
 * Attributes persisted on a {@link CREDENTIALS_SO_TYPE} saved object. The
 * `*ApiKey` fields are encrypted at rest; everything else is plaintext
 * metadata. Optional fields are absent when the user has not supplied them.
 */
export interface CredentialsSOAttributes {
  /**
   * NEW source of truth (multi-provider). Encrypted-at-rest JSON object mapping
   * each configured provider to its raw apiKey: `{ [provider]: apiKey }`. Absent
   * on legacy docs written before the multi-provider migration (those are read
   * back from the `primary*`/`fallback*` fields below). Never logged.
   */
  providerKeysJson?: string;
  /**
   * NEW source of truth (multi-provider). Plaintext JSON object of per-provider
   * metadata in the user's saved order:
   * `{ [provider]: { model?, endpoint?, hasKey } }`. `hasKey` mirrors whether an
   * encrypted key exists for that provider (a non-decrypting read strips
   * {@link providerKeysJson}, so masked reads rely on this flag). Absent on
   * legacy docs.
   */
  providerMetaJson?: string;
  primaryProvider: ProviderName;
  primaryModel?: string;
  primaryEndpoint?: string;
  /** Encrypted at rest. Absent when the provider needs no key (e.g. ollama). */
  primaryApiKey?: string;
  /**
   * Plaintext flag mirroring whether {@link primaryApiKey} is set. Required
   * because a non-decrypting read STRIPS the encrypted key, so masked reads
   * cannot infer key presence from `primaryApiKey` — they read this instead.
   */
  primaryHasKey?: boolean;
  fallbackEnabled: boolean;
  fallbackProvider?: ProviderName;
  fallbackModel?: string;
  fallbackEndpoint?: string;
  /** Encrypted at rest. Absent when the fallback provider needs no key. */
  fallbackApiKey?: string;
  /** Plaintext flag mirroring whether {@link fallbackApiKey} is set. */
  fallbackHasKey?: boolean;
}

/**
 * The saved object type definition. The encrypted apiKey fields are mapped as
 * `binary` (matching the platform's entity-discovery-api-key example) since
 * their stored form is ciphertext that is never queried; all other fields are
 * `keyword`/`boolean`.
 */
export const credentialsType: SavedObjectsType = {
  name: CREDENTIALS_SO_TYPE,
  hidden: true,
  namespaceType: 'agnostic',
  mappings: {
    dynamic: false,
    properties: {
      // Multi-provider (new). The encrypted key blob is `binary` (ciphertext,
      // never queried); the plaintext metadata JSON is stored as an unindexed
      // keyword (never searched — read whole and JSON.parsed).
      providerKeysJson: { type: 'binary' },
      providerMetaJson: { type: 'keyword', index: false },
      primaryProvider: { type: 'keyword' },
      primaryModel: { type: 'keyword' },
      primaryEndpoint: { type: 'keyword' },
      primaryApiKey: { type: 'binary' },
      primaryHasKey: { type: 'boolean' },
      fallbackEnabled: { type: 'boolean' },
      fallbackProvider: { type: 'keyword' },
      fallbackModel: { type: 'keyword' },
      fallbackEndpoint: { type: 'keyword' },
      fallbackApiKey: { type: 'binary' },
      fallbackHasKey: { type: 'boolean' },
    },
  },
  management: {
    importableAndExportable: false,
    displayName: 'Query Copilot credentials',
  },
};
