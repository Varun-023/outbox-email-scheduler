import type { Client } from '@elastic/elasticsearch';
import type { Redis } from 'ioredis';
import type { Pool } from 'mysql2/promise';
import { pino, type Logger } from 'pino';
import type { Env } from '../../src/config/env';
import { createDatabase, createDatabasePool, type Database } from '../../src/db/client';
import { SecretBox } from '../../src/lib/crypto';
import { createElasticsearchClient } from '../../src/modules/search/es-client';
import { closeQueues, createQueues, type Queues } from '../../src/queue/queues';
import { closeRedisConnection, createRedisConnection } from '../../src/queue/redis';
import { integrationEnv } from './test-env';

const APP_TABLES = ['emails', 'campaigns', 'senders', 'slack_connections', 'users'];

/** Real MySQL + Redis connections for one integration test file. */
export interface TestContext {
  env: Env;
  logger: Logger;
  pool: Pool;
  db: Database;
  redis: Redis;
  queues: Queues;
  secrets: SecretBox;
  elasticsearch: Client;
  /** Truncates every application table and flushes the test Redis database. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function createTestContext(overrides: Record<string, string> = {}): TestContext {
  const env = integrationEnv(overrides);
  const logger = pino({ level: 'silent' });
  const pool = createDatabasePool({ url: env.DATABASE_URL, connectionLimit: 10 });
  const redis = createRedisConnection(env.REDIS_URL, logger);
  const queues = createQueues(redis, {
    prefix: env.BULLMQ_PREFIX,
    emailJobAttempts: env.EMAIL_JOB_ATTEMPTS,
    emailJobBackoffMs: env.EMAIL_JOB_BACKOFF_MS,
  });
  const elasticsearch = createElasticsearchClient(env.ELASTICSEARCH_URL);

  return {
    env,
    logger,
    pool,
    db: createDatabase(pool),
    redis,
    queues,
    secrets: new SecretBox(env.ENCRYPTION_KEY),
    elasticsearch,
    async reset() {
      const connection = await pool.getConnection();
      try {
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        for (const table of APP_TABLES) await connection.query('TRUNCATE TABLE ??', [table]);
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
      } finally {
        connection.release();
      }
      await redis.flushdb();
      try {
        await elasticsearch.indices.delete({ index: `${env.ES_INDEX_PREFIX}_*` });
      } catch {
        // Index might not exist yet
      }
    },
    async close() {
      await closeQueues(queues);
      await closeRedisConnection(redis);
      await pool.end();
      await elasticsearch.close();
    },
  };
}

/** Polls until `check` returns a truthy value (test helper only). */
export async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {},
): Promise<T> {
  const { timeoutMs = 15_000, intervalMs = 50, message = 'condition' } = options;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Redis time minus host time, in ms. The send gate uses Redis TIME, and Docker's VM clock
 * drifts a few ms from the host, so window assertions convert host timestamps with this.
 */
export async function redisClockOffset(redis: Redis): Promise<number> {
  const samples: number[] = [];
  for (let i = 0; i < 7; i += 1) {
    const before = Date.now();
    const [seconds, micros] = await redis.time();
    const after = Date.now();
    samples.push(Number(seconds) * 1000 + Math.floor(Number(micros) / 1000) - (before + after) / 2);
  }
  samples.sort((a, b) => a - b);
  return samples[3] as number;
}

/** Waits until the start of a fresh rate-limit window, so window assertions are not flaky. */
export async function alignToWindowStart(windowMs: number, marginMs = 150): Promise<void> {
  const offset = Date.now() % windowMs;
  if (offset < marginMs) return;
  await sleep(windowMs - offset + 20);
}
