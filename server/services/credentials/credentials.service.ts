import {
  SavedObjectsErrorHelpers,
  type SavedObjectsClientContract,
} from '@kbn/core/server';
import type { EncryptedSavedObjectsClient } from '@kbn/encrypted-saved-objects-plugin/server';
import type { RequestCredentials, ProviderCredential, ProviderName } from '../../../common/types';
import {
  CREDENTIALS_SO_TYPE,
  type CredentialsSOAttributes,
} from '../../saved_objects/credentials.type';

// ---------------------------------------------------------------------------
// CredentialsService
//
// Encapsulates per-user LLM credential storage backed by an encrypted saved
// object (one record per user, deterministic id derived from the username).
//
// The two apiKey attributes are encrypted at rest by encryptedSavedObjects;
// decryption goes through the ESO start client's getDecryptedAsInternalUser.
// Raw keys are NEVER returned to the browser (getMaskedForUser only ever
// exposes a `hasKey` boolean) and are NEVER logged here.
// ---------------------------------------------------------------------------

/** Per-provider input accepted by {@link CredentialsService.saveForUser}. */
export interface CredentialInput {
  provider: ProviderName;
  model?: string;
  endpoint?: string;
  /** Omit/empty to PRESERVE the existing encrypted key on update. Never logged. */
  apiKey?: string;
}

/** Body accepted by {@link CredentialsService.saveForUser}. */
export interface SaveCredentialsInput {
  primary: CredentialInput;
  fallback?: {
    enabled: boolean;
    provider?: ProviderName;
    model?: string;
    endpoint?: string;
    apiKey?: string;
  } | null;
}

/** Masked metadata for a single provider slot. Never carries a raw key. */
export interface MaskedProvider {
  provider: ProviderName;
  model: string | null;
  endpoint: string | null;
  hasKey: boolean;
}

/** Masked status returned to the browser by {@link CredentialsService.getMaskedForUser}. */
export interface MaskedCredentials {
  primary: MaskedProvider;
  fallback: (MaskedProvider & { enabled: boolean }) | null;
}

/**
 * A request-scoped saved objects client that INCLUDES the hidden credentials
 * type. Built per request from the authenticated user's scope so writes/reads
 * honour the platform's space + RBAC plumbing.
 */
export type ScopedSoClientFactory = () => SavedObjectsClientContract;

export class CredentialsService {
  constructor(
    /** ESO start client scoped to the credentials hidden type, for decryption. */
    private readonly esoClient: EncryptedSavedObjectsClient,
    /** Builds a request-scoped SO client that includes the hidden type. */
    private readonly getScopedClient: ScopedSoClientFactory
  ) {}

  /**
   * Deterministic saved object id for a user. We key on the authenticated
   * `username` (stable across sessions and human-readable); it is sanitised to
   * a conservative id charset so it is always a valid SO id.
   */
  public idForUser(username: string): string {
    const safe = username.replace(/[^a-zA-Z0-9_.-]/g, '_');
    return `creds:${safe}`;
  }

  /**
   * Upserts the user's credentials. On update, any apiKey field left
   * omitted/empty PRESERVES the existing encrypted key (loaded first) so a user
   * can edit provider/model/endpoint without re-entering their key.
   */
  public async saveForUser(username: string, input: SaveCredentialsInput): Promise<void> {
    const id = this.idForUser(username);
    const client = this.getScopedClient();

    const existing = await this.readRaw(client, id);

    const fallback = input.fallback ?? null;
    const fallbackEnabled = fallback?.enabled ?? false;

    const attributes: CredentialsSOAttributes = {
      primaryProvider: input.primary.provider,
      primaryModel: input.primary.model,
      primaryEndpoint: input.primary.endpoint,
      primaryApiKey: pickKey(input.primary.apiKey, existing?.primaryApiKey),
      fallbackEnabled,
      fallbackProvider: fallback?.provider,
      fallbackModel: fallback?.model,
      fallbackEndpoint: fallback?.endpoint,
      fallbackApiKey: fallbackEnabled
        ? pickKey(fallback?.apiKey, existing?.fallbackApiKey)
        : undefined,
    };

    await client.create<CredentialsSOAttributes>(CREDENTIALS_SO_TYPE, attributes, {
      id,
      overwrite: true,
    });
  }

  /**
   * Returns metadata only (provider/model/endpoint + a `hasKey` boolean). NEVER
   * returns raw keys. Reads via the normal (non-decrypting) scoped client.
   * Returns null when the user has no stored credentials.
   */
  public async getMaskedForUser(username: string): Promise<MaskedCredentials | null> {
    const client = this.getScopedClient();
    const attrs = await this.readRaw(client, this.idForUser(username));
    if (!attrs) {
      return null;
    }

    const fallback =
      attrs.fallbackEnabled && attrs.fallbackProvider
        ? {
            enabled: true,
            provider: attrs.fallbackProvider,
            model: attrs.fallbackModel ?? null,
            endpoint: attrs.fallbackEndpoint ?? null,
            hasKey: Boolean(attrs.fallbackApiKey),
          }
        : null;

    return {
      primary: {
        provider: attrs.primaryProvider,
        model: attrs.primaryModel ?? null,
        endpoint: attrs.primaryEndpoint ?? null,
        hasKey: Boolean(attrs.primaryApiKey),
      },
      fallback,
    };
  }

  /**
   * Reads the user's credentials WITH decrypted keys and builds the
   * {@link RequestCredentials} bundle the provider router consumes. Returns null
   * when no SO exists, or when the primary slot has no usable key for a provider
   * that requires one (ollama needs none).
   */
  public async getDecryptedCredentialsForUser(
    username: string
  ): Promise<RequestCredentials | null> {
    const id = this.idForUser(username);

    let attrs: CredentialsSOAttributes;
    try {
      const so = await this.esoClient.getDecryptedAsInternalUser<CredentialsSOAttributes>(
        CREDENTIALS_SO_TYPE,
        id
      );
      attrs = so.attributes;
    } catch (error) {
      if (SavedObjectsErrorHelpers.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }

    const primary = toProviderCredential(
      attrs.primaryProvider,
      attrs.primaryModel,
      attrs.primaryEndpoint,
      attrs.primaryApiKey
    );

    // Without a usable primary key (for a provider that needs one) the bundle is
    // unusable; signal "not configured" rather than handing back a broken cred.
    if (!hasUsableKey(primary)) {
      return null;
    }

    const fallback =
      attrs.fallbackEnabled && attrs.fallbackProvider
        ? toProviderCredential(
            attrs.fallbackProvider,
            attrs.fallbackModel,
            attrs.fallbackEndpoint,
            attrs.fallbackApiKey
          )
        : null;

    return { primary, fallback: hasUsableKey(fallback) ? fallback : null };
  }

  /** Deletes the user's credentials. A missing SO is treated as a no-op. */
  public async deleteForUser(username: string): Promise<void> {
    const client = this.getScopedClient();
    try {
      await client.delete(CREDENTIALS_SO_TYPE, this.idForUser(username));
    } catch (error) {
      if (SavedObjectsErrorHelpers.isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }

  /** Loads raw (still-encrypted) attributes, or null when the SO is absent. */
  private async readRaw(
    client: SavedObjectsClientContract,
    id: string
  ): Promise<CredentialsSOAttributes | null> {
    try {
      const so = await client.get<CredentialsSOAttributes>(CREDENTIALS_SO_TYPE, id);
      return so.attributes;
    } catch (error) {
      if (SavedObjectsErrorHelpers.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * Chooses the incoming key when present/non-empty, otherwise preserves the
 * existing stored key (so users can edit metadata without re-entering keys).
 */
function pickKey(incoming: string | undefined, existing: string | undefined): string | undefined {
  if (incoming && incoming.length > 0) {
    return incoming;
  }
  return existing;
}

function toProviderCredential(
  provider: ProviderName,
  model: string | undefined,
  endpoint: string | undefined,
  apiKey: string | undefined
): ProviderCredential {
  return { provider, model, endpoint, apiKey };
}

/**
 * A credential is usable when it has a key, or when its provider needs none
 * (ollama runs locally). Used to decide whether a stored bundle is complete.
 */
function hasUsableKey(cred: ProviderCredential | null): cred is ProviderCredential {
  if (!cred) {
    return false;
  }
  if (cred.provider === 'ollama') {
    return true;
  }
  return Boolean(cred.apiKey && cred.apiKey.length > 0);
}
