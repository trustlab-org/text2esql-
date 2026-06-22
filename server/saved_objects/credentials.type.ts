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
  primaryProvider: ProviderName;
  primaryModel?: string;
  primaryEndpoint?: string;
  /** Encrypted at rest. Absent when the provider needs no key (e.g. ollama). */
  primaryApiKey?: string;
  fallbackEnabled: boolean;
  fallbackProvider?: ProviderName;
  fallbackModel?: string;
  fallbackEndpoint?: string;
  /** Encrypted at rest. Absent when the fallback provider needs no key. */
  fallbackApiKey?: string;
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
      primaryProvider: { type: 'keyword' },
      primaryModel: { type: 'keyword' },
      primaryEndpoint: { type: 'keyword' },
      primaryApiKey: { type: 'binary' },
      fallbackEnabled: { type: 'boolean' },
      fallbackProvider: { type: 'keyword' },
      fallbackModel: { type: 'keyword' },
      fallbackEndpoint: { type: 'keyword' },
      fallbackApiKey: { type: 'binary' },
    },
  },
  management: {
    importableAndExportable: false,
    displayName: 'Query Copilot credentials',
  },
};
