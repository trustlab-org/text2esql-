import type { RedisOptions } from 'ioredis';

// Capture the options ioredis is constructed with (avoids inspecting mock.calls tuples).
let capturedOptions: RedisOptions | undefined;
const mockRedisOn = jest.fn();
const mockRedisInstance = { on: mockRedisOn, status: 'connecting' };
const mockRedisCtor = jest.fn((options?: RedisOptions) => {
  capturedOptions = options;
  return mockRedisInstance;
});
jest.mock('ioredis', () => ({ __esModule: true, default: mockRedisCtor }));

import type { Logger } from '@kbn/core/server';
import type { RedisConfig } from '../../config';

// Loaded via require (NOT a hoisted top-level import): a top-level import would be
// hoisted above the const mock declarations and trigger the jest.mock factory before
// `mockRedisCtor` is initialized (temporal-dead-zone ReferenceError).
const { RedisClientFactory } = require('./redis.client') as typeof import('./redis.client');

function makeLogger() {
  return {
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    log: jest.fn(),
    get: jest.fn(),
  };
}

const config: RedisConfig = { host: 'redis-host', port: 6380, ttl: 300 };

beforeEach(() => {
  jest.clearAllMocks();
  capturedOptions = undefined;
  mockRedisInstance.status = 'connecting';
});

describe('RedisClientFactory', () => {
  describe('createClient', () => {
    it('constructs ioredis with host/port from config', () => {
      const logger = makeLogger();
      new RedisClientFactory(logger as unknown as Logger).createClient(config);

      expect(mockRedisCtor).toHaveBeenCalledTimes(1);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions?.host).toBe('redis-host');
      expect(capturedOptions?.port).toBe(6380);
      expect(capturedOptions?.maxRetriesPerRequest).toBe(5);
    });

    it('configures an exponential-backoff retryStrategy capped after 5 attempts', () => {
      const logger = makeLogger();
      new RedisClientFactory(logger as unknown as Logger).createClient(config);

      const retry = capturedOptions?.retryStrategy;
      expect(typeof retry).toBe('function');

      const delay1 = retry!(1) as number;
      const delay2 = retry!(2) as number;
      expect(delay1).toBeGreaterThan(0);
      expect(delay2).toBeGreaterThan(delay1); // exponential growth
      expect(retry!(6)).toBeNull(); // gives up after 5 attempts
      expect(logger.warn).toHaveBeenCalled();
    });

    it('registers an error listener that logs a warning and never throws', () => {
      const logger = makeLogger();
      new RedisClientFactory(logger as unknown as Logger).createClient(config);

      const errorCall = mockRedisOn.mock.calls.find((call) => call[0] === 'error');
      expect(errorCall).toBeDefined();

      const errorHandler = errorCall![1] as (error: Error) => void;
      expect(() => errorHandler(new Error('ECONNREFUSED'))).not.toThrow();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns the created client instance', () => {
      const logger = makeLogger();
      expect(new RedisClientFactory(logger as unknown as Logger).createClient(config)).toBe(
        mockRedisInstance
      );
    });
  });
});
