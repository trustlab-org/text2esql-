import { v5 as uuidv5 } from 'uuid';
import {
  SavedObjectsErrorHelpers,
  type SavedObjectsClientContract,
} from '@kbn/core/server';
import type { EncryptedSavedObjectsClient } from '@kbn/encrypted-saved-objects-plugin/server';
import type {
  RequestCredentials,
  ProviderCredential,
  ProviderName,
  MaskedProvider,
  MaskedCredentials,
  SaveCredentialInput,
  SaveCredentialsInput,
} from '../../../common/types';
import {
  CREDENTIALS_SO_TYPE,
  type CredentialsSOAttributes,
} from '../../saved_objects/credentials.type';

// The frontend-facing masked/save shapes are the finalized common contract; the
// service consumes and produces them directly. `CredentialInput` is kept as an
// alias of the common per-provider input for existing importers.
export type { MaskedProvider, MaskedCredentials, SaveCredentialInput, SaveCredentialsInput };
export type CredentialInput = SaveCredentialInput;

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

/**
 * A request-scoped saved objects client that INCLUDES the hidden credentials
 * type. Built per request from the authenticated user's scope so writes/reads
 * honour the platform's space + RBAC plumbing.
 */
export type ScopedSoClientFactory = () => SavedObjectsClientContract;

/**
 * Fixed namespace for deriving per-user credential ids via UUIDv5. Encrypted
 * saved objects reject a predefined id unless it is a UUID (see
 * SavedObjectsUtils.isRandomId), so we map the username to a deterministic
 * UUID rather than using a human-readable id.
 */
const CREDENTIALS_ID_NAMESPACE = 'b6c7f3a0-9d2e-4c1b-8a5f-3e7d6c4b2a10';

export class CredentialsService {
  constructor(
    /** ESO start client scoped to the credentials hidden type, for decryption. */
    private readonly esoClient: EncryptedSavedObjectsClient,
    /** Builds a request-scoped SO client that includes the hidden type. */
    private readonly getScopedClient: ScopedSoClientFactory
  ) {}

  /**
   * Deterministic saved object id for a user. Keyed on the authenticated
   * `username` (stable across sessions) but emitted as a UUIDv5, because
   * encryptedSavedObjects rejects a predefined id for an encrypted object
   * unless it is a UUID. Same username -> same id (idempotent upsert);
   * different usernames -> different ids.
   */
  public idForUser(username: string): string {
    return uuidv5(username, CREDENTIALS_ID_NAMESPACE);
  }

  /**
   * Upserts the user's credentials (multi-provider: 1..5 slots, one per
   * provider, in the user's chosen order). On update, any apiKey field left
   * omitted/empty PRESERVES the existing encrypted key (loaded first, merging
   * legacy + new storage) so a user can edit provider/model/endpoint without
   * re-entering their key.
   *
   * The new `providerKeysJson`/`providerMetaJson` attributes are the single
   * source of truth going forward. The legacy `primary*` fields are mirrored to
   * the chosen primary provider (so any un-migrated reader still sees a sane
   * primary and the AAD stays consistent) and the legacy `fallback*` fields are
   * cleared to avoid stale duplicates.
   */
  public async saveForUser(username: string, input: SaveCredentialsInput): Promise<void> {
    const id = this.idForUser(username);
    const client = this.getScopedClient();

    // Read existing WITH decryption so an omitted apiKey preserves the stored
    // key. A non-decrypting read strips the encrypted keys, which would
    // silently wipe the key whenever the user edits provider/model only. The
    // merged read also surfaces keys stored under the legacy shape.
    const existing = await this.readDecrypted(id);
    const existingState = existing
      ? this.parseStored(existing, true)
      : { providers: [], primaryProvider: null };
    const existingKeyByProvider = new Map<ProviderName, string | undefined>();
    for (const slot of existingState.providers) {
      existingKeyByProvider.set(slot.provider, slot.apiKey);
    }

    // Build the new slots in incoming order, deduped by provider (first wins).
    const keysJson: Record<string, string> = {};
    const metaJson: Record<string, ProviderMetaEntry> = {};
    const order: ProviderName[] = [];
    const seen = new Set<ProviderName>();
    for (const slot of input.providers) {
      if (seen.has(slot.provider)) {
        continue;
      }
      seen.add(slot.provider);
      order.push(slot.provider);

      const apiKey = pickKey(slot.apiKey, existingKeyByProvider.get(slot.provider));
      // Ollama runs locally and is always "usable"; every other provider has a
      // key iff one is stored/supplied.
      const hasKey = slot.provider === 'ollama' ? true : Boolean(apiKey);
      if (apiKey) {
        keysJson[slot.provider] = apiKey;
      }
      metaJson[slot.provider] = { model: slot.model, endpoint: slot.endpoint, hasKey };
    }

    // The default primary is the named provider when it is one of the saved
    // slots, else the first slot (the schema guarantees at least one).
    const primaryProvider: ProviderName =
      input.primaryProvider && seen.has(input.primaryProvider)
        ? input.primaryProvider
        : order[0]!;
    const primaryMeta = metaJson[primaryProvider];
    const primaryApiKey = keysJson[primaryProvider];

    const attributes: CredentialsSOAttributes = {
      // New source of truth (multi-provider).
      providerKeysJson: JSON.stringify(keysJson),
      providerMetaJson: JSON.stringify(metaJson),
      // Legacy mirror of the primary provider — keeps un-migrated readers and
      // the encryption AAD consistent.
      primaryProvider,
      primaryModel: primaryMeta?.model,
      primaryEndpoint: primaryMeta?.endpoint,
      primaryApiKey,
      primaryHasKey: primaryMeta?.hasKey ?? Boolean(primaryApiKey),
      // Clear the legacy fallback slot so it can never resurface as a stale
      // duplicate once the new attributes are authoritative.
      fallbackEnabled: false,
      fallbackProvider: undefined,
      fallbackModel: undefined,
      fallbackEndpoint: undefined,
      fallbackApiKey: undefined,
      fallbackHasKey: false,
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

    // Non-decrypting read: keys are stripped, so `hasKey` comes from the
    // plaintext metadata (new `providerMetaJson`, or legacy hasKey flags).
    const state = this.parseStored(attrs, false);
    const providers: MaskedProvider[] = state.providers.map((slot) => ({
      provider: slot.provider,
      model: slot.model ?? null,
      endpoint: slot.endpoint ?? null,
      hasKey: slot.hasKey,
    }));

    return { providers, primaryProvider: state.primaryProvider };
  }

  /**
   * Reads the user's credentials WITH decrypted keys and builds the
   * {@link RequestCredentials} bundle the provider router consumes. The bundle
   * is an ORDERED provider list, primaryProvider-first then the rest in saved
   * order; providers with no usable key (non-ollama with an empty key) are
   * dropped. Returns null when no SO exists or the resulting list is empty.
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

    const state = this.parseStored(attrs, true);
    const ordered = hoistPrimary(state.providers, state.primaryProvider);

    const providers: ProviderCredential[] = [];
    for (const slot of ordered) {
      const cred: ProviderCredential = {
        provider: slot.provider,
        model: slot.model,
        endpoint: slot.endpoint,
        apiKey: slot.apiKey,
      };
      // Drop slots that need a key but have none — a broken cred would only
      // fail routing; the router should never see it.
      if (hasUsableKey(cred)) {
        providers.push(cred);
      }
    }

    if (providers.length === 0) {
      return null;
    }

    return { providers };
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

  /**
   * Loads masked (non-decrypting) attributes, or null when the SO is absent.
   * The encrypted `*ApiKey` fields are stripped from this read.
   */
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

  /** Loads DECRYPTED attributes (keys included) via ESO, or null when absent. */
  private async readDecrypted(id: string): Promise<CredentialsSOAttributes | null> {
    try {
      const so = await this.esoClient.getDecryptedAsInternalUser<CredentialsSOAttributes>(
        CREDENTIALS_SO_TYPE,
        id
      );
      return so.attributes;
    } catch (error) {
      if (SavedObjectsErrorHelpers.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Normalises stored attributes into an ordered provider list + default
   * primary, hiding the two storage generations from callers.
   *
   * The NEW `providerMetaJson`/`providerKeysJson` attributes are authoritative
   * when present (the meta JSON's key order is the user's saved order). When
   * they are ABSENT the doc predates the multi-provider migration, so the list
   * is reconstructed from the legacy `primary*`/`fallback*` fields (deduped by
   * provider, primary first) — a user who saved keys under the old shape keeps
   * them with zero migration.
   *
   * `withKeys` is true only for decrypted reads; masked reads leave `apiKey`
   * undefined (the encrypted attributes are stripped) and rely on `hasKey`.
   */
  private parseStored(attrs: CredentialsSOAttributes, withKeys: boolean): StoredState {
    const meta = safeParseObject(attrs.providerMetaJson);
    if (meta) {
      const keys = withKeys ? safeParseObject(attrs.providerKeysJson) ?? {} : {};
      const providers: StoredSlot[] = [];
      // Object key order === insertion order === the user's saved order.
      for (const provider of Object.keys(meta) as ProviderName[]) {
        const entry = (meta[provider] ?? {}) as ProviderMetaEntry;
        const key = withKeys ? (keys[provider] as string | undefined) : undefined;
        providers.push({
          provider,
          model: entry.model,
          endpoint: entry.endpoint,
          apiKey: key,
          hasKey: Boolean(entry.hasKey),
        });
      }
      return {
        providers,
        primaryProvider: attrs.primaryProvider ?? providers[0]?.provider ?? null,
      };
    }

    // ── Legacy fallback: reconstruct from the primary*/fallback* fields. ──────
    const providers: StoredSlot[] = [];
    const seen = new Set<ProviderName>();
    const pushSlot = (
      provider: ProviderName | undefined,
      model: string | undefined,
      endpoint: string | undefined,
      apiKey: string | undefined,
      hasKey: boolean
    ): void => {
      if (!provider || seen.has(provider)) {
        return;
      }
      seen.add(provider);
      providers.push({
        provider,
        model,
        endpoint,
        apiKey: withKeys ? apiKey : undefined,
        hasKey,
      });
    };

    if (attrs.primaryProvider) {
      pushSlot(
        attrs.primaryProvider,
        attrs.primaryModel,
        attrs.primaryEndpoint,
        attrs.primaryApiKey,
        attrs.primaryHasKey ?? Boolean(attrs.primaryApiKey)
      );
    }
    if (attrs.fallbackEnabled && attrs.fallbackProvider) {
      pushSlot(
        attrs.fallbackProvider,
        attrs.fallbackModel,
        attrs.fallbackEndpoint,
        attrs.fallbackApiKey,
        attrs.fallbackHasKey ?? Boolean(attrs.fallbackApiKey)
      );
    }

    return {
      providers,
      primaryProvider: attrs.primaryProvider ?? providers[0]?.provider ?? null,
    };
  }
}

/** Plaintext per-provider metadata entry stored inside `providerMetaJson`. */
interface ProviderMetaEntry {
  model?: string;
  endpoint?: string;
  hasKey: boolean;
}

/** A single normalised provider slot from {@link CredentialsService.parseStored}. */
interface StoredSlot {
  provider: ProviderName;
  model?: string;
  endpoint?: string;
  /** Present only on decrypted reads. */
  apiKey?: string;
  hasKey: boolean;
}

/** Normalised, storage-generation-agnostic view of a user's stored credentials. */
interface StoredState {
  providers: StoredSlot[];
  primaryProvider: ProviderName | null;
}

/** JSON.parses `value` into a plain object, or returns null on any failure. */
function safeParseObject(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns `slots` reordered so the slot matching `primaryProvider` comes first,
 * preserving the relative order of the rest. A no-op when the primary is null or
 * not present in the list.
 */
function hoistPrimary(slots: StoredSlot[], primaryProvider: ProviderName | null): StoredSlot[] {
  if (!primaryProvider) {
    return slots;
  }
  const primary = slots.filter((s) => s.provider === primaryProvider);
  if (primary.length === 0) {
    return slots;
  }
  const rest = slots.filter((s) => s.provider !== primaryProvider);
  return [...primary, ...rest];
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
