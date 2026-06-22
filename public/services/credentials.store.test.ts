/**
 * @jest-environment jsdom
 */
import type { RequestCredentials } from '../../common/types';
import {
  CREDENTIALS_STORAGE_KEY,
  clearCredentials,
  hasUsablePrimary,
  loadCredentials,
  saveCredentials,
} from './credentials.store';

describe('credentials.store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('round-trips a save -> load', () => {
    const creds: RequestCredentials = {
      primary: { provider: 'anthropic', apiKey: 'sk-primary', model: 'claude-x' },
      fallback: { provider: 'openai', apiKey: 'sk-fallback' },
    };

    saveCredentials(creds);

    expect(loadCredentials()).toEqual(creds);
  });

  it('persists under the documented storage key', () => {
    saveCredentials({ primary: { provider: 'groq', apiKey: 'k' } });
    expect(window.localStorage.getItem(CREDENTIALS_STORAGE_KEY)).not.toBeNull();
  });

  it('clear removes the stored bundle', () => {
    saveCredentials({ primary: { provider: 'groq', apiKey: 'k' } });
    clearCredentials();
    expect(loadCredentials()).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadCredentials()).toBeNull();
  });

  it('returns null on corrupt JSON', () => {
    window.localStorage.setItem(CREDENTIALS_STORAGE_KEY, '{not valid json');
    expect(loadCredentials()).toBeNull();
  });

  it('returns null when the primary provider is unknown/missing', () => {
    window.localStorage.setItem(
      CREDENTIALS_STORAGE_KEY,
      JSON.stringify({ primary: { provider: 'bogus', apiKey: 'k' } })
    );
    expect(loadCredentials()).toBeNull();
  });

  it('drops an invalid fallback but keeps the primary', () => {
    window.localStorage.setItem(
      CREDENTIALS_STORAGE_KEY,
      JSON.stringify({
        primary: { provider: 'anthropic', apiKey: 'k' },
        fallback: { provider: 'nope' },
      })
    );
    expect(loadCredentials()).toEqual({ primary: { provider: 'anthropic', apiKey: 'k' } });
  });

  it('returns null without throwing when localStorage access throws (private mode)', () => {
    jest.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('access denied');
    });
    expect(loadCredentials()).toBeNull();
  });

  describe('hasUsablePrimary', () => {
    it('false for null', () => {
      expect(hasUsablePrimary(null)).toBe(false);
    });

    it('false when a non-ollama primary has no key', () => {
      expect(hasUsablePrimary({ primary: { provider: 'openai' } })).toBe(false);
    });

    it('true when a non-ollama primary has a key', () => {
      expect(hasUsablePrimary({ primary: { provider: 'openai', apiKey: 'k' } })).toBe(true);
    });

    it('true for ollama even without an api key', () => {
      expect(hasUsablePrimary({ primary: { provider: 'ollama' } })).toBe(true);
    });
  });
});
