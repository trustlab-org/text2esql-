import { useCallback, useState } from 'react';

import type { RequestCredentials } from '../../common/types';
import {
  clearCredentials as clearStored,
  loadCredentials,
  saveCredentials,
} from '../services/credentials.store';

/**
 * Reactive view over the browser-persisted {@link RequestCredentials}.
 *
 * Seeds its state from {@link loadCredentials} on first render so a previously
 * saved bundle is visible immediately. `setCredentials` writes through to
 * localStorage (via {@link saveCredentials}) AND updates React state so any
 * consumers (the settings panel, the gate) re-render. `clearCredentials` removes
 * the persisted bundle and resets state to null.
 */
export interface UseCredentialsResult {
  readonly credentials: RequestCredentials | null;
  readonly setCredentials: (creds: RequestCredentials) => void;
  readonly clearCredentials: () => void;
}

export function useCredentials(): UseCredentialsResult {
  const [credentials, setState] = useState<RequestCredentials | null>(() => loadCredentials());

  const setCredentials = useCallback((creds: RequestCredentials): void => {
    saveCredentials(creds);
    setState(creds);
  }, []);

  const clearCredentials = useCallback((): void => {
    clearStored();
    setState(null);
  }, []);

  return { credentials, setCredentials, clearCredentials };
}
