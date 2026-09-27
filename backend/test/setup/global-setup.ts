import { Redis } from 'ioredis';
import { createDatabasePool } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';
import { dropAllTables } from '../../src/db/reset';
import { requireTestEnv } from '../helpers/test-env';

/**
 * Runs once per integration run: empties the test database completely (including the
 * migration history) and applies every migration from scratch, then clears test Redis.
 */
export default async function setup(): Promise<void> {
  const env = requireTestEnv(['DATABASE_URL_TEST', 'REDIS_URL_TEST']);

  const pool = createDatabasePool({ url: env.DATABASE_URL_TEST, connectionLimit: 1 });
  try {
    await dropAllTables(pool);
  } finally {
    await pool.end();
  }
  await runMigrations(env.DATABASE_URL_TEST);

  const redis = new Redis(env.REDIS_URL_TEST);
  try {
    await redis.flushdb();
  } finally {
    await redis.quit();
  }
}
