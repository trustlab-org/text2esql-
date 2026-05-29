export interface CacheEntry<T = unknown> {
  readonly key: string;
  readonly value: T;
  readonly createdAt: string; // ISO 8601
  readonly expiresAt: string; // ISO 8601
  readonly hitCount: number;
  readonly lastAccessedAt: string; // ISO 8601
  readonly sizeBytes: number;
  readonly tags: readonly string[];
}

export interface CacheStats {
  readonly totalEntries: number;
  readonly totalSizeBytes: number;
  readonly hitCount: number;
  readonly missCount: number;
  readonly hitRatio: number;
  readonly evictionCount: number;
  readonly oldestEntryAt: string | null; // ISO 8601
}

export type CacheKeyStrategy = 'exact' | 'normalized' | 'semantic';
