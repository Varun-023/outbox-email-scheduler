import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

// `drizzle-kit generate` only reads the schema; the URL matters for introspection commands.
if (existsSync('../.env')) {
  process.loadEnvFile('../.env');
}

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
});
