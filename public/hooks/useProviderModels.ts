import { useCallback, useRef, useState } from 'react';

import type { DiscoveredModel, ProviderName } from '../../common/types';
import { ApiError, useServices } from '../services';

/**
 * Reactive model discovery for one provider slot.
 *
 * `discover` POSTs to the model-discovery endpoint via
 * {@link ProviderApiService.discoverModels}. Successful lists are memoised in a
 * small module-level cache so switching back and forth between providers (or
 * between the Primary/Fallback cards) does not refetch within the page's
 * lifetime; `forceRefresh` bypasses both this cache and the server's.
 * API keys are never stored in the cache key (only a typed/stored marker) and
 * never logged.
 */

/** Lifecycle of the current discovery call. */
export type ProviderModelsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Input for one explicit discovery call. */
export interface DiscoverModelsSpec {
  readonly provider: ProviderName;
  /** Raw key typed by the user; omit/empty to use the stored key. Never logged. */
  readonly apiKey?: string;
  /** Endpoint override (Ollama). */
  readonly endpoint?: string;
  /** Bypass the in-memory cache AND the server's 5-minute cache. */
  readonly forceRefresh?: boolean;
}

export interface UseProviderModelsResult {
  /** Models from the last successful discovery ([] while idle/loading/error). */
  readonly models: readonly DiscoveredModel[];
  readonly status: ProviderModelsStatus;
  /** Friendly server message when the last discovery failed, else null. */
  readonly error: string | null;
  /** Runs discovery; resolves true on success, false on failure (never throws). */
  readonly discover: (spec: DiscoverModelsSpec) => Promise<boolean>;
  /** Clears models/error back to the pristine 'idle' state. */
  readonly reset: () => void;
}

/**
 * Module-level cache of the last successful list per slot spec. Keyed WITHOUT
 * the raw key material — only whether a typed key was used vs the stored one.
 */
const discoveredModelsCache = new Map<string, readonly DiscoveredModel[]>();

function cacheKeyFor(spec: DiscoverModelsSpec): string {
  return `${spec.provider}|${spec.apiKey ? 'typed' : 'stored'}|${spec.endpoint ?? ''}`;
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Model discovery failed.';
}

export function useProviderModels(): UseProviderModelsResult {
  const { providerApi } = useServices();

  const [models, setModels] = useState<readonly DiscoveredModel[]>([]);
  const [status, setStatus] = useState<ProviderModelsStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Monotonic sequence so a stale in-flight response never clobbers a newer one.
  const requestSeqRef = useRef<number>(0);

  const reset = useCallback((): void => {
    requestSeqRef.current += 1;
    setModels([]);
    setStatus('idle');
    setError(null);
  }, []);

  const discover = useCallback(
    async (spec: DiscoverModelsSpec): Promise<boolean> => {
      const cacheKey = cacheKeyFor(spec);
      if (spec.forceRefresh !== true) {
        const cached = discoveredModelsCache.get(cacheKey);
        if (cached !== undefined) {
          requestSeqRef.current += 1;
          setModels(cached);
          setStatus('ready');
          setError(null);
          return true;
        }
      }

      const requestId = ++requestSeqRef.current;
      setStatus('loading');
      setError(null);
      try {
        const response = await providerApi.discoverModels({
          provider: spec.provider,
          apiKey: spec.apiKey,
          endpoint: spec.endpoint,
          forceRefresh: spec.forceRefresh,
        });
        if (requestId !== requestSeqRef.current) {
          return false;
        }
        discoveredModelsCache.set(cacheKey, response.models);
        setModels(response.models);
        setStatus('ready');
        return true;
      } catch (e) {
        if (requestId !== requestSeqRef.current) {
          return false;
        }
        setModels([]);
        setStatus('error');
        setError(toMessage(e));
        return false;
      }
    },
    [providerApi]
  );

  return { models, status, error, discover, reset };
}
