import { SavedObjectsErrorHelpers } from '@kbn/core/server';
import { CredentialsService } from './credentials.service';
import { CREDENTIALS_SO_TYPE, type CredentialsSOAttributes } from '../../saved_objects/credentials.type';

// ---------------------------------------------------------------------------
// CredentialsService unit tests.
//
// The SO client and the ESO start client are plain typed jest mocks. We assert
// the upsert/preserve-on-update/masking/decryption/delete behaviour and that
// raw keys are never surfaced by the masked path.
// ---------------------------------------------------------------------------

function notFound(): Error {
  return SavedObjectsErrorHelpers.createGenericNotFoundError(CREDENTIALS_SO_TYPE, 'creds:alice');
}

function makeScopedClient() {
  return {
    get: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  };
}

function makeEsoClient() {
  return {
    getDecryptedAsInternalUser: jest.fn(),
  };
}

function makeService(scoped = makeScopedClient(), eso = makeEsoClient()) {
  const service = new CredentialsService(eso as any, () => scoped as any);
  return { service, scoped, eso };
}

describe('CredentialsService', () => {
  describe('idForUser', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('derives a deterministic UUID per user (required by encrypted saved objects)', () => {
      const { service } = makeService();
      // Encrypted SOs reject predefined non-UUID ids, so the id must be a UUID.
      expect(service.idForUser('alice')).toMatch(UUID_RE);
      // Deterministic: same username -> same id (idempotent upsert).
      expect(service.idForUser('alice')).toBe(service.idForUser('alice'));
      // Distinct usernames -> distinct ids.
      expect(service.idForUser('alice')).not.toBe(service.idForUser('bob'));
    });
  });

  describe('saveForUser', () => {
    it('creates the SO with overwrite, an explicit id, the new JSON attributes, and a hasKey flag', async () => {
      const { service, scoped, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockRejectedValue(notFound());

      await service.saveForUser('alice', {
        providers: [{ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-123' }],
      });

      expect(scoped.create).toHaveBeenCalledTimes(1);
      const [type, attrs, opts] = scoped.create.mock.calls[0];
      expect(type).toBe(CREDENTIALS_SO_TYPE);
      expect(opts).toEqual({ id: service.idForUser('alice'), overwrite: true });
      const a = attrs as CredentialsSOAttributes;
      // New source of truth.
      expect(JSON.parse(a.providerKeysJson!)).toEqual({ openai: 'sk-123' });
      expect(JSON.parse(a.providerMetaJson!)).toEqual({
        openai: { model: 'gpt-4o', hasKey: true },
      });
      // Legacy mirror of the primary + cleared fallback.
      expect(a.primaryProvider).toBe('openai');
      expect(a.primaryApiKey).toBe('sk-123');
      expect(a.primaryHasKey).toBe(true);
      expect(a.fallbackEnabled).toBe(false);
      expect(a.fallbackApiKey).toBeUndefined();
    });

    it('preserves the existing (decrypted) key when none is supplied on update (from a legacy doc)', async () => {
      const { service, scoped, eso } = makeService();
      // Existing key must be read WITH decryption, else it would be wiped. Here
      // the stored doc predates the migration (legacy shape) — the merged read
      // still surfaces the key.
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          primaryProvider: 'openai',
          primaryApiKey: 'sk-existing',
          primaryHasKey: true,
          fallbackEnabled: false,
        } as CredentialsSOAttributes,
      });

      await service.saveForUser('alice', {
        providers: [{ provider: 'openai', model: 'gpt-4o-mini' }], // metadata edit, no key
      });

      const attrs = scoped.create.mock.calls[0][1] as CredentialsSOAttributes;
      expect(JSON.parse(attrs.providerKeysJson!)).toEqual({ openai: 'sk-existing' });
      expect(attrs.primaryApiKey).toBe('sk-existing');
      expect(attrs.primaryHasKey).toBe(true);
      expect(attrs.primaryModel).toBe('gpt-4o-mini');
    });

    it('stores multiple providers and honours the chosen primaryProvider', async () => {
      const { service, scoped, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockRejectedValue(notFound());

      await service.saveForUser('alice', {
        providers: [
          { provider: 'openai', apiKey: 'sk-1' },
          { provider: 'anthropic', apiKey: 'sk-2' },
        ],
        primaryProvider: 'anthropic',
      });

      const attrs = scoped.create.mock.calls[0][1] as CredentialsSOAttributes;
      expect(JSON.parse(attrs.providerKeysJson!)).toEqual({ openai: 'sk-1', anthropic: 'sk-2' });
      expect(JSON.parse(attrs.providerMetaJson!)).toEqual({
        openai: { hasKey: true },
        anthropic: { hasKey: true },
      });
      // The named primary is mirrored to the legacy primary* fields.
      expect(attrs.primaryProvider).toBe('anthropic');
      expect(attrs.primaryApiKey).toBe('sk-2');
      expect(attrs.fallbackEnabled).toBe(false);
    });
  });

  describe('getMaskedForUser', () => {
    it('returns null when the SO does not exist', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockRejectedValue(notFound());
      await expect(service.getMaskedForUser('alice')).resolves.toBeNull();
    });

    it('lists provider slots and derives hasKey from the plaintext meta JSON (keys are stripped on a masked read)', async () => {
      const { service, scoped } = makeService();
      // A non-decrypting read does NOT return providerKeysJson; hasKey comes
      // from providerMetaJson, which is plaintext.
      scoped.get.mockResolvedValue({
        attributes: {
          providerMetaJson: JSON.stringify({
            openai: { model: 'gpt-4o', hasKey: true },
            anthropic: { hasKey: true },
          }),
          primaryProvider: 'openai',
        } as CredentialsSOAttributes,
      });

      const masked = await service.getMaskedForUser('alice');
      expect(masked).toEqual({
        providers: [
          { provider: 'openai', model: 'gpt-4o', endpoint: null, hasKey: true },
          { provider: 'anthropic', model: null, endpoint: null, hasKey: true },
        ],
        primaryProvider: 'openai',
      });
      expect(JSON.stringify(masked)).not.toContain('sk-secret');
    });

    it('reads a legacy doc (no JSON attributes) back into the provider list', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockResolvedValue({
        attributes: {
          primaryProvider: 'openai',
          primaryModel: 'gpt-4o',
          primaryHasKey: true,
          fallbackEnabled: true,
          fallbackProvider: 'anthropic',
          fallbackHasKey: true,
        } as CredentialsSOAttributes,
      });
      const masked = await service.getMaskedForUser('alice');
      expect(masked).toEqual({
        providers: [
          { provider: 'openai', model: 'gpt-4o', endpoint: null, hasKey: true },
          { provider: 'anthropic', model: null, endpoint: null, hasKey: true },
        ],
        primaryProvider: 'openai',
      });
    });

    it('reports hasKey false for an ollama-only legacy doc', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockResolvedValue({
        attributes: {
          primaryProvider: 'ollama',
          fallbackEnabled: false,
        } as CredentialsSOAttributes,
      });
      const masked = await service.getMaskedForUser('alice');
      expect(masked?.providers).toEqual([
        { provider: 'ollama', model: null, endpoint: null, hasKey: false },
      ]);
      expect(masked?.primaryProvider).toBe('ollama');
    });
  });

  describe('getDecryptedCredentialsForUser', () => {
    it('returns null when the SO does not exist', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockRejectedValue(notFound());
      await expect(service.getDecryptedCredentialsForUser('alice')).resolves.toBeNull();
    });

    it('builds an ordered RequestCredentials list from the decrypted JSON attributes (primary first)', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          providerKeysJson: JSON.stringify({ openai: 'sk-decrypted', anthropic: 'sk-fb' }),
          providerMetaJson: JSON.stringify({
            anthropic: { hasKey: true },
            openai: { model: 'gpt-4o', hasKey: true },
          }),
          // primaryProvider is hoisted to the front regardless of meta order.
          primaryProvider: 'openai',
        } as CredentialsSOAttributes,
      });

      const creds = await service.getDecryptedCredentialsForUser('alice');
      expect(creds).toEqual({
        providers: [
          { provider: 'openai', model: 'gpt-4o', endpoint: undefined, apiKey: 'sk-decrypted' },
          { provider: 'anthropic', model: undefined, endpoint: undefined, apiKey: 'sk-fb' },
        ],
      });
      expect(eso.getDecryptedAsInternalUser).toHaveBeenCalledWith(
        CREDENTIALS_SO_TYPE,
        service.idForUser('alice')
      );
    });

    it('reconstructs the list from a legacy doc (backward compat, zero migration)', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          primaryProvider: 'openai',
          primaryModel: 'gpt-4o',
          primaryApiKey: 'sk-decrypted',
          fallbackEnabled: true,
          fallbackProvider: 'anthropic',
          fallbackApiKey: 'sk-fb',
        } as CredentialsSOAttributes,
      });

      const creds = await service.getDecryptedCredentialsForUser('alice');
      expect(creds).toEqual({
        providers: [
          { provider: 'openai', model: 'gpt-4o', endpoint: undefined, apiKey: 'sk-decrypted' },
          { provider: 'anthropic', model: undefined, endpoint: undefined, apiKey: 'sk-fb' },
        ],
      });
    });

    it('drops providers with no usable key and returns null when the list is empty', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          providerMetaJson: JSON.stringify({ openai: { hasKey: false } }),
          providerKeysJson: JSON.stringify({}),
          primaryProvider: 'openai',
        } as CredentialsSOAttributes,
      });
      await expect(service.getDecryptedCredentialsForUser('alice')).resolves.toBeNull();
    });

    it('treats ollama as usable without a key', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          providerMetaJson: JSON.stringify({
            ollama: { endpoint: 'http://localhost:11434', hasKey: true },
          }),
          providerKeysJson: JSON.stringify({}),
          primaryProvider: 'ollama',
        } as CredentialsSOAttributes,
      });
      const creds = await service.getDecryptedCredentialsForUser('alice');
      expect(creds?.providers).toEqual([
        { provider: 'ollama', model: undefined, endpoint: 'http://localhost:11434', apiKey: undefined },
      ]);
    });
  });

  describe('deleteForUser', () => {
    it('deletes the SO by id', async () => {
      const { service, scoped } = makeService();
      scoped.delete.mockResolvedValue({});
      await service.deleteForUser('alice');
      expect(scoped.delete).toHaveBeenCalledWith(CREDENTIALS_SO_TYPE, service.idForUser('alice'));
    });

    it('ignores a 404 (already deleted)', async () => {
      const { service, scoped } = makeService();
      scoped.delete.mockRejectedValue(notFound());
      await expect(service.deleteForUser('alice')).resolves.toBeUndefined();
    });
  });
});
