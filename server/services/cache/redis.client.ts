/**
 * Factory for creating ioredis clients used by the query_copilot cache layer.
 *
 * The client is configured with an exponential-backoff reconnect strategy
 * (capped at {@link MAX_RECONNECT_ATTEMPTS}) and an error listener that logs a
 * warning instead of letting an unhandled `error` event crash the plugin.
 */
import Redis, { type RedisOptions } from 'ioredis';
import type { Logger } from '@kbn/core/server';
import type { RedisConfig } from '../../config';

/** Maximum reconnection attempts before ioredis stops retrying. */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Creates pre-configured ioredis clients for the cache layer.
 */
export class RedisClientFactory {
  constructor(private readonly logger: Logger) {}

  /**
   * Creates an ioredis client with an exponential-backoff reconnect strategy
   * (capped at MAX_RECONNECT_ATTEMPTS) and an error listener that logs a warning
   * rather than letting an unhandled 'error' event crash the plugin.
   */
  createClient(config: RedisConfig): Redis {
    const options: RedisOptions = {
      host: config.host,
      port: config.port,
      maxRetriesPerRequest: MAX_RECONNECT_ATTEMPTS,
      enableReadyCheck: true,
      retryStrategy: (times) => this.reconnectDelay(times),
    };

    const client = new Redis(options);

    client.on('error', (error: Error) => {
      this.logger.warn(`[query_copilot][redis] connection error: ${error.message}`);
    });
    client.on('reconnecting', () => {
      this.logger.debug('[query_copilot][redis] reconnecting');
    });
    client.on('ready', () => {
      this.logger.debug('[query_copilot][redis] connection ready');
    });
    client.on('end', () => {
      this.logger.warn('[query_copilot][redis] connection closed');
    });

    return client;
  }

  /**
   * Exponential-backoff delay between reconnection attempts. Returns `null` to
   * stop retrying once {@link MAX_RECONNECT_ATTEMPTS} has been exceeded.
   */
  private reconnectDelay(times: number): number | null {
    if (times > MAX_RECONNECT_ATTEMPTS) {
      this.logger.warn(
        `[query_copilot][redis] giving up after ${MAX_RECONNECT_ATTEMPTS} reconnection attempts`
      );
      return null;
    }
    return Math.min(2 ** times * 100, 10_000);
  }
}
