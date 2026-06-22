import { useCallback, useEffect, useState } from 'react';

import type { MaskedCredentials, SaveCredentialsInput } from '../../common/types';
import { ApiError, useServices } from '../services';

/**
 * Reactive view over the user's server-stored LLM credentials (masked metadata
 * only — raw keys never reach the browser).
 *
 * Loads the masked status from the server on mount. `save` POSTs the new bundle
 * (only carrying a raw key when the user typed one) and refreshes local status;
 * `clear` DELETEs the stored credentials. An optional `onChange` callback fires
 * after any successful save/clear/refresh so a consumer can refresh GLOBAL state
 * (e.g. the copilot context that gates generation and drives the banner).
 */
export interface UseCredentialsResult {
  readonly status: MaskedCredentials | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly save: (input: SaveCredentialsInput) => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Credentials request failed.';
}

export function useCredentials(onChange?: () => void): UseCredentialsResult {
  const { credentialsApi } = useServices();

  const [status, setStatus] = useState<MaskedCredentials | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await credentialsApi.getCredentials();
      setStatus(next);
    } catch (e) {
      // No stored credentials (or a transient failure) means "nothing configured".
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [credentialsApi]);

  const save = useCallback(
    async (input: SaveCredentialsInput): Promise<void> => {
      setError(null);
      try {
        const next = await credentialsApi.saveCredentials(input);
        setStatus(next);
        onChange?.();
      } catch (e) {
        setError(toMessage(e));
        throw e;
      }
    },
    [credentialsApi, onChange]
  );

  const clear = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await credentialsApi.deleteCredentials();
      setStatus(null);
      onChange?.();
    } catch (e) {
      setError(toMessage(e));
      throw e;
    }
  }, [credentialsApi, onChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { status, loading, error, save, clear, refresh };
}
