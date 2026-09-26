import type { Client } from '@elastic/elasticsearch';
import type { Redis } from 'ioredis';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createDatabasePool, pingDatabase } from '../../src/db/client';
import { createElasticsearchClient, pingElasticsearch } from '../../src/modules/search/es-client';
import { closeRedisConnection, createRedisConnection } from '../../src/queue/redis';
import { requireTestEnv } from '../helpers/test-env';

// Verifies the Docker Compose services match what later phases rely on.
const env = requireTestEnv(['DATABASE_URL_TEST', 'REDIS_URL_TEST', 'ELASTICSEARCH_URL']);
const logger = pino({ level: 'silent' });

let pool: Pool;
let redis: Redis;
let elasticsearch: Client;

beforeAll(() => {
  pool = createDatabasePool({ url: env.DATABASE_URL_TEST, connectionLimit: 2 });
  redis = createRedisConnection(env.REDIS_URL_TEST, logger);
  elasticsearch = createElasticsearchClient(env.ELASTICSEARCH_URL);
});

afterAll(async () => {
  await Promise.all([pool.end(), closeRedisConnection(redis), elasticsearch.close()]);
});

describe('MySQL', () => {
  it('lets the app user into the test database created by the init script', async () => {
    const [rows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS db');

    expect(rows[0]?.db).toBe(new URL(env.DATABASE_URL_TEST).pathname.slice(1));
    expect(rows[0]?.db).toMatch(/_test$/);
  });

  it('runs MySQL 8 with the UTC, utf8mb4 and READ COMMITTED settings the schema relies on', async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT VERSION() AS version,
              @@global.time_zone AS globalTimeZone,
              @@session.time_zone AS sessionTimeZone,
              @@character_set_server AS charset,
              @@collation_server AS collation,
              @@collation_connection AS connectionCollation,
              @@transaction_isolation AS isolation,
              @@max_connections AS maxConnections`,
    );

    expect(rows[0]).toMatchObject({
      globalTimeZone: '+00:00',
      sessionTimeZone: '+00:00',
      charset: 'utf8mb4',
      collation: 'utf8mb4_0900_ai_ci',
      connectionCollation: 'utf8mb4_0900_ai_ci',
      isolation: 'READ-COMMITTED',
      maxConnections: 200,
    });
    expect(rows[0]?.version).toMatch(/^8\./);
  });
});

describe('Redis', () => {
  it('answers PING', async () => {
    await expect(redis.ping()).resolves.toBe('PONG');
  });

  it('persists with AOF every second and never evicts keys (required by BullMQ)', async () => {
    const setting = async (name: string) => ((await redis.config('GET', name)) as string[])[1];

    expect(await setting('appendonly')).toBe('yes');
    expect(await setting('appendfsync')).toBe('everysec');
    expect(await setting('maxmemory-policy')).toBe('noeviction');
  });
});

describe('Elasticsearch', () => {
  it('is reachable and runs a healthy 8.x cluster', async () => {
    await expect(pingElasticsearch(elasticsearch)).resolves.toBeUndefined();

    const info = await elasticsearch.info();
    const health = await elasticsearch.cluster.health();

    expect(info.version.number).toMatch(/^8\./);
    expect(['green', 'yellow']).toContain(health.status);
  });
});

describe('GET /api/health/ready against real services', () => {
  it('reports every dependency as ok', async () => {
    const app = createApp({
      config: { TRUST_PROXY: 1 },
      logger,
      healthChecks: [
        { name: 'mysql', critical: true, check: () => pingDatabase(pool) },
        {
          name: 'redis',
          critical: true,
          check: async () => {
            await redis.ping();
          },
        },
        { name: 'elasticsearch', critical: false, check: () => pingElasticsearch(elasticsearch) },
      ],
    });

    const res = await request(app).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { mysql: 'ok', redis: 'ok', elasticsearch: 'ok' },
    });
  });
});
