import { CacheService } from './cache.service';
import type Redis from 'ioredis';
import type { ConfigService } from '../config';
import type { LoggerService } from '../observability';
import type { QueryPipelineResult } from '../../../common/types';

const result = { pipelineId: 'p1', status: 'succeeded' } as unknown as QueryPipelineResult;

function makeRedis(status = 'ready') {
  return { status, get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
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

function makeService(redis: ReturnType<typeof makeRedis>, logger = makeLogger()) {
  return {
    svc: new CacheService(
      redis as unknown as Redis,
      makeConfig() as unknown as ConfigService,
      logger as unknown as LoggerService
    ),
    logger,
  };
}

describe('CacheService', () => {
  describe('get', () => {
    it('returns the deserialized result on a cache hit', async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(JSON.stringify(result));
      const { svc } = makeService(redis);

      const got = await svc.get('k');

      expect(got).toEqual(result);
      expect(got?.pipelineId).toBe('p1');
    });

    it('returns null on a cache miss', async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue(null);
      const { svc } = makeService(redis);

      expect(await svc.get('k')).toBeNull();
    });

    it('returns null without calling redis when unavailable', async () => {
      const redis = makeRedis('connecting');
      const { svc } = makeService(redis);

      expect(await svc.get('k')).toBeNull();
      expect(redis.get).not.toHaveBeenCalled();
    });

    it('returns null and logs on a redis error', async () => {
      const redis = makeRedis();
      redis.get.mockRejectedValue(new Error('boom'));
      const { svc, logger } = makeService(redis);

      expect(await svc.get('k')).toBeNull();
      expect(logger.logError).toHaveBeenCalled();
    });

    it('returns null and logs on invalid JSON', async () => {
      const redis = makeRedis();
      redis.get.mockResolvedValue('not-json{');
      const { svc, logger } = makeService(redis);

      expect(await svc.get('k')).toBeNull();
      expect(logger.logError).toHaveBeenCalled();
    });
  });

  describe('set', () => {
    it('stores using the default ttl', async () => {
      const redis = makeRedis();
      const { svc } = makeService(redis);

      await svc.set('k', result);

      expect(redis.set).toHaveBeenCalledWith('k', JSON.stringify(result), 'EX', 300);
    });

    it('stores using an explicit ttl', async () => {
      const redis = makeRedis();
      const { svc } = makeService(redis);

      await svc.set('k', result, 60);

      expect(redis.set).toHaveBeenCalledWith('k', expect.any(String), 'EX', 60);
    });

    it('does not call redis when unavailable', async () => {
      const redis = makeRedis('connecting');
      const { svc } = makeService(redis);

      await expect(svc.set('k', result)).resolves.toBeUndefined();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('resolves without throwing and logs on a redis error', async () => {
      const redis = makeRedis();
      redis.set.mockRejectedValue(new Error('down'));
      const { svc, logger } = makeService(redis);

      await expect(svc.set('k', result)).resolves.toBeUndefined();
      expect(logger.logError).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('is true when status is ready', () => {
      const { svc } = makeService(makeRedis('ready'));
      expect(svc.isAvailable()).toBe(true);
    });

    it('is false when status is connecting', () => {
      const { svc } = makeService(makeRedis('connecting'));
      expect(svc.isAvailable()).toBe(false);
    });

    it('is false when status is end', () => {
      const { svc } = makeService(makeRedis('end'));
      expect(svc.isAvailable()).toBe(false);
    });
  });
});
