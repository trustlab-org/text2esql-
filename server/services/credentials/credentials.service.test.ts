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
    it('derives a deterministic, sanitised id', () => {
      const { service } = makeService();
      expect(service.idForUser('alice')).toBe('creds:alice');
      expect(service.idForUser('a/b c@d')).toBe('creds:a_b_c_d');
    });
  });

  describe('saveForUser', () => {
    it('creates the SO with overwrite and an explicit id', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockRejectedValue(notFound());

      await service.saveForUser('alice', {
        primary: { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-123' },
        fallback: null,
      });

      expect(scoped.create).toHaveBeenCalledTimes(1);
      const [type, attrs, opts] = scoped.create.mock.calls[0];
      expect(type).toBe(CREDENTIALS_SO_TYPE);
      expect(opts).toEqual({ id: 'creds:alice', overwrite: true });
      expect((attrs as CredentialsSOAttributes).primaryApiKey).toBe('sk-123');
      expect((attrs as CredentialsSOAttributes).fallbackEnabled).toBe(false);
    });

    it('preserves the existing key when none is supplied on update', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockResolvedValue({
        attributes: {
          primaryProvider: 'openai',
          primaryApiKey: 'sk-existing',
          fallbackEnabled: false,
        } as CredentialsSOAttributes,
      });

      await service.saveForUser('alice', {
        primary: { provider: 'openai', model: 'gpt-4o-mini' }, // metadata edit, no key
        fallback: null,
      });

      const attrs = scoped.create.mock.calls[0][1] as CredentialsSOAttributes;
      expect(attrs.primaryApiKey).toBe('sk-existing');
      expect(attrs.primaryModel).toBe('gpt-4o-mini');
    });

    it('stores fallback key only when fallback is enabled', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockRejectedValue(notFound());

      await service.saveForUser('alice', {
        primary: { provider: 'openai', apiKey: 'sk-1' },
        fallback: { enabled: true, provider: 'anthropic', apiKey: 'sk-2' },
      });

      const attrs = scoped.create.mock.calls[0][1] as CredentialsSOAttributes;
      expect(attrs.fallbackEnabled).toBe(true);
      expect(attrs.fallbackProvider).toBe('anthropic');
      expect(attrs.fallbackApiKey).toBe('sk-2');
    });
  });

  describe('getMaskedForUser', () => {
    it('returns null when the SO does not exist', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockRejectedValue(notFound());
      await expect(service.getMaskedForUser('alice')).resolves.toBeNull();
    });

    it('returns metadata + hasKey but NEVER the raw key', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockResolvedValue({
        attributes: {
          primaryProvider: 'openai',
          primaryModel: 'gpt-4o',
          primaryEndpoint: undefined,
          primaryApiKey: 'sk-secret',
          fallbackEnabled: true,
          fallbackProvider: 'anthropic',
          fallbackApiKey: 'sk-secret-2',
        } as CredentialsSOAttributes,
      });

      const masked = await service.getMaskedForUser('alice');
      expect(masked).toEqual({
        primary: { provider: 'openai', model: 'gpt-4o', endpoint: null, hasKey: true },
        fallback: {
          enabled: true,
          provider: 'anthropic',
          model: null,
          endpoint: null,
          hasKey: true,
        },
      });
      expect(JSON.stringify(masked)).not.toContain('sk-secret');
    });

    it('omits the fallback when it is disabled', async () => {
      const { service, scoped } = makeService();
      scoped.get.mockResolvedValue({
        attributes: {
          primaryProvider: 'ollama',
          fallbackEnabled: false,
        } as CredentialsSOAttributes,
      });
      const masked = await service.getMaskedForUser('alice');
      expect(masked?.fallback).toBeNull();
      expect(masked?.primary.hasKey).toBe(false);
    });
  });

  describe('getDecryptedCredentialsForUser', () => {
    it('returns null when the SO does not exist', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockRejectedValue(notFound());
      await expect(service.getDecryptedCredentialsForUser('alice')).resolves.toBeNull();
    });

    it('builds RequestCredentials from decrypted attributes', async () => {
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
        primary: { provider: 'openai', model: 'gpt-4o', endpoint: undefined, apiKey: 'sk-decrypted' },
        fallback: {
          provider: 'anthropic',
          model: undefined,
          endpoint: undefined,
          apiKey: 'sk-fb',
        },
      });
      expect(eso.getDecryptedAsInternalUser).toHaveBeenCalledWith(
        CREDENTIALS_SO_TYPE,
        'creds:alice'
      );
    });

    it('returns null when the primary provider needs a key but has none', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          primaryProvider: 'openai',
          fallbackEnabled: false,
        } as CredentialsSOAttributes,
      });
      await expect(service.getDecryptedCredentialsForUser('alice')).resolves.toBeNull();
    });

    it('treats ollama as usable without a key', async () => {
      const { service, eso } = makeService();
      eso.getDecryptedAsInternalUser.mockResolvedValue({
        attributes: {
          primaryProvider: 'ollama',
          primaryEndpoint: 'http://localhost:11434',
          fallbackEnabled: false,
        } as CredentialsSOAttributes,
      });
      const creds = await service.getDecryptedCredentialsForUser('alice');
      expect(creds?.primary.provider).toBe('ollama');
      expect(creds?.fallback).toBeNull();
    });
  });

  describe('deleteForUser', () => {
    it('deletes the SO by id', async () => {
      const { service, scoped } = makeService();
      scoped.delete.mockResolvedValue({});
      await service.deleteForUser('alice');
      expect(scoped.delete).toHaveBeenCalledWith(CREDENTIALS_SO_TYPE, 'creds:alice');
    });

    it('ignores a 404 (already deleted)', async () => {
      const { service, scoped } = makeService();
      scoped.delete.mockRejectedValue(notFound());
      await expect(service.deleteForUser('alice')).resolves.toBeUndefined();
    });
  });
});
