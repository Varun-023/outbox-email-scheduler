// Drops every table in DATABASE_URL and re-applies all migrations. Local development only.
import { loadEnvOrExit } from '../src/config/env';
import { createDatabasePool } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { dropAllTables } from '../src/db/reset';

const env = loadEnvOrExit();
if (env.NODE_ENV === 'production') {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

const pool = createDatabasePool({ url: env.DATABASE_URL, connectionLimit: 1 });
try {
  await dropAllTables(pool);
} finally {
  await pool.end();
}
await runMigrations(env.DATABASE_URL);
console.warn('Database reset and migrated.');
