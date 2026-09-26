import { Redis, type RedisOptions } from 'ioredis';
import type { Logger } from 'pino';

/**
 * Creates an ioredis connection that logs state changes instead of crashing on unhandled
 * 'error' events. While Redis is down ioredis keeps retrying, so repeated identical errors
 * are logged once.
 */
export function createRedisConnection(
  url: string,
  logger: Logger,
  options: RedisOptions = {},
): Redis {
  const redis = new Redis(url, options);
  let lastErrorMessage: string | undefined;

  redis.on('ready', () => {
    lastErrorMessage = undefined;
    logger.info('Redis connection ready');
  });
  redis.on('error', (err: Error) => {
    if (err.message === lastErrorMessage) return;
    lastErrorMessage = err.message;
    logger.warn({ err }, 'Redis connection error');
  });

  return redis;
}

/** QUIT flushes pending replies on a live connection; otherwise just stop reconnecting. */
export async function closeRedisConnection(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    await redis.quit();
  } else {
    redis.disconnect();
  }
}
