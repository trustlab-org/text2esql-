/**
 * Integration test for the cache key flow (Task 4.2).
 *
 * Proves the end-to-end key path: a normalized query's `cacheKey`
 * (QueryNormalizer) feeds CacheKeyBuilder.buildKey, and the built key is
 * exactly what CacheService uses against Redis. Same query + same index yields
 * the same key (cache hit); a different index or a different query yields a
 * different key (no false cross-index hit, no false cross-query hit).
 */
import { QueryNormalizer } from '../intent';
import { CacheKeyBuilder } from './cache.key.builder';
import { CacheService } from './cache.service';
import type Redis from 'ioredis';
import type { ConfigService } from '../config';
import type { LoggerService } from '../observability';
import type { QueryPipelineResult } from '../../../common/types';

function makeRedis(status = 'ready') {
  return { status, get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
}

function makeConfig() {
  return {
    getRedisConfig: jest.fn().mockReturnValue({ host: 'h', port: 6379, ttl: 300 }),
    isCacheEnabled: jest.fn().mockReturnValue(true),
  };
}

function makeLogger() {
  return {
    logError: jest.fn(),
    logRequest: jest.fn(),
    logPipelineStage: jest.fn(),
    logProviderCall: jest.fn(),
    logCacheEvent: jest.fn(),
  };
}

const result = { pipelineId: 'p1', status: 'succeeded' } as unknown as QueryPipelineResult;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const BUILT_KEY = /^qc:v1:[a-f0-9]{64}:[a-f0-9]{64}$/;

describe('cache key integration (normalizer -> key builder -> cache service)', () => {
  it('normalizer produces a deterministic SHA-256 cacheKey', () => {
    const n = new QueryNormalizer();
    const a = n.normalize('Show failed logins for admin');
    const b = n.normalize('Show failed logins for admin');

    expect(a.cacheKey).toBe(b.cacheKey);
    expect(a.cacheKey).toMatch(SHA256_HEX);
  });

  it('key builder consumes the normalizer hash and embeds it', () => {
    const n = new QueryNormalizer();
    const a = n.normalize('Show failed logins for admin');

    const kb = new CacheKeyBuilder();
    const key = kb.buildKey(a.cacheKey, 'logs-*');

    expect(key).toMatch(BUILT_KEY);
    expect(key.endsWith(':' + a.cacheKey)).toBe(true);
  });

  it('the built key is exactly what CacheService uses against Redis', async () => {
    const n = new QueryNormalizer();
    const a = n.normalize('Show failed logins for admin');

    const kb = new CacheKeyBuilder();
    const key = kb.buildKey(a.cacheKey, 'logs-*');

    const redis = makeRedis();
    const svc = new CacheService(
      redis as unknown as Redis,
      makeConfig() as unknown as ConfigService,
      makeLogger() as unknown as LoggerService
    );

    await svc.set(key, result);
    expect(redis.set).toHaveBeenCalledWith(key, expect.any(String), 'EX', 300);

    await svc.get(key);
    expect(redis.get).toHaveBeenCalledWith(key);
  });

  it('same query + same index produces the same key (cache hit)', () => {
    const n = new QueryNormalizer();
    const a = n.normalize('Show failed logins for admin');
    const b = n.normalize('Show failed logins for admin');

    const kb = new CacheKeyBuilder();
    const keyA = kb.buildKey(a.cacheKey, 'logs-*');
    const keyB = kb.buildKey(b.cacheKey, 'logs-*');

    expect(keyA).toBe(keyB);
  });

  it('same query + different index produces a different key (no false cross-index hit)', () => {
    const n = new QueryNormalizer();
    const a = n.normalize('Show failed logins for admin');

    const kb = new CacheKeyBuilder();
    const keyA = kb.buildKey(a.cacheKey, 'logs-a');
    const keyB = kb.buildKey(a.cacheKey, 'logs-b');

    expect(keyA).not.toBe(keyB);
    expect(keyA.endsWith(':' + a.cacheKey)).toBe(true);
    expect(keyB.endsWith(':' + a.cacheKey)).toBe(true);
  });

  it('different query produces a different key', () => {
    const n = new QueryNormalizer();
    const a = n.normalize('Show failed logins for admin');
    const b = n.normalize('Show successful logins for guest');

    expect(a.cacheKey).not.toBe(b.cacheKey);

    const kb = new CacheKeyBuilder();
    const keyA = kb.buildKey(a.cacheKey, 'logs-*');
    const keyB = kb.buildKey(b.cacheKey, 'logs-*');

    expect(keyA).not.toBe(keyB);
  });
});
