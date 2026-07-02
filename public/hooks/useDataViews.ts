import { useCallback, useEffect, useRef, useState } from 'react';

import type { DataViewSummary } from '../../common/types';
import { useServices } from '../services';
import type { DataViewsApiService } from '../services';

/**
 * Reactive view over the Kibana Data Views exposed by the server.
 *
 * The list is fetched once on mount and shared across all mounted consumers via
 * a module-level cache with a short TTL, so several components using this hook
 * do not trigger duplicate network requests. `refresh()` always bypasses the
 * cache and re-fetches from the server.
 */
export interface UseDataViewsResult {
  readonly dataViews: readonly DataViewSummary[];
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
}

/** User-friendly message surfaced when the data-views endpoint fails. */
const LOAD_ERROR_MESSAGE = 'Could not load data views from Kibana.';

/** How long a cached fetch result stays fresh, in milliseconds. */
const CACHE_TTL_MS = 60_000;

interface DataViewsCache {
  /** In-flight or settled fetch shared between concurrent mounts. */
  readonly promise: Promise<readonly DataViewSummary[]>;
  /** Epoch millis at which the fetch was started. */
  readonly fetchedAt: number;
}

let dataViewsCache: DataViewsCache | null = null;

/**
 * Returns the cached data views, fetching from the server when the cache is
 * missing, expired, or explicitly bypassed. Failed fetches are evicted so the
 * next call retries instead of caching the error for the full TTL.
 */
function fetchDataViews(
  api: DataViewsApiService,
  bypassCache: boolean
): Promise<readonly DataViewSummary[]> {
  const now = Date.now();
  if (!bypassCache && dataViewsCache !== null && now - dataViewsCache.fetchedAt < CACHE_TTL_MS) {
    return dataViewsCache.promise;
  }
  const promise = api.getDataViews().then((response) => response.dataViews);
  const entry: DataViewsCache = { promise, fetchedAt: now };
  dataViewsCache = entry;
  promise.catch(() => {
    // Evict the failed entry (unless a newer fetch already replaced it).
    if (dataViewsCache === entry) {
      dataViewsCache = null;
    }
  });
  return promise;
}

export function useDataViews(): UseDataViewsResult {
  const { dataViewsApi } = useServices();

  const [dataViews, setDataViews] = useState<readonly DataViewSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Guards state updates after unmount (the shared promise may settle later).
  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (bypassCache: boolean): Promise<void> => {
      setIsLoading(true);
      setError(null);
      try {
        const views = await fetchDataViews(dataViewsApi, bypassCache);
        if (isMountedRef.current) {
          setDataViews(views);
        }
      } catch {
        if (isMountedRef.current) {
          setError(LOAD_ERROR_MESSAGE);
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [dataViewsApi]
  );

  /** Re-fetches from the server, bypassing the module-level TTL cache. */
  const refresh = useCallback(async (): Promise<void> => {
    await load(true);
  }, [load]);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { dataViews, isLoading, error, refresh };
}
