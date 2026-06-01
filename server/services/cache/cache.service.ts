/**
 * Redis-backed cache for the query pipeline.
 *
 * Stores {@link QueryPipelineResult} values as JSON strings in Redis, keyed by
 * a caller-supplied cache key (typically a normalized-query hash). Values are
 * written with a TTL so stale results expire automatically.
 *
 * The service is designed to degrade gracefully: Redis is treated as a best-
 * effort accelerator, never a hard dependency. When the connection is not in
 * its `'ready'` state, or when any Redis/serialization error occurs, reads
 * return `null` (a cache miss) and writes silently do nothing. No method on
 * this service ever throws — unexpected errors are logged via
 * {@link LoggerService.logError} and then swallowed so the calling pipeline can
 * proceed against the source of truth.
 */

import type Redis from 'ioredis';
import type { QueryPipelineResult } from '../../../common/types';
import type { ConfigService } from '../config';
import type { LoggerService } from '../observability';

/**
 * Caches query pipeline results in Redis with graceful degradation.
 *
 * All operations are non-throwing: on an unavailable connection or any runtime
 * error, reads behave as misses and writes are skipped.
 */
export class CacheService {
  private readonly defaultTtlSeconds: number;

  constructor(
    private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly logger: LoggerService
  ) {
    this.defaultTtlSeconds = this.config.getRedisConfig().ttl;
  }

  /** Returns the cached result, or null on miss / unavailable / any error. Deserializes JSON. */
  async get(key: string): Promise<QueryPipelineResult | null> {
    if (!this.isAvailable()) {
      return null;
    }
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        return null;
      }
      return JSON.parse(raw) as QueryPipelineResult;
    } catch (error) {
      this.logger.logError('cache', error, { operation: 'get', key });
      return null;
    }
  }

  /** Serializes the result to JSON and stores it with a TTL. Silently skips when unavailable. */
  async set(key: string, result: QueryPipelineResult, ttlSeconds?: number): Promise<void> {
    if (!this.isAvailable()) {
      return;
    }
    try {
      const ttl = ttlSeconds ?? this.defaultTtlSeconds;
      await this.redis.set(key, JSON.stringify(result), 'EX', ttl);
    } catch (error) {
      this.logger.logError('cache', error, { operation: 'set', key });
    }
  }

  /** True only when the Redis connection is ready to serve commands. */
  isAvailable(): boolean {
    return this.redis.status === 'ready';
  }
}
