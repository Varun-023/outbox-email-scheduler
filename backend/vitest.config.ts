import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests talk to the Docker Compose services configured in the root .env.
// Variables already set in the environment (e.g. in CI) take precedence.
const rootEnvFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts', 'test/scenarios/**/*.test.ts'],
          // Drops and re-migrates the test database once per run (migration from empty).
          globalSetup: ['./test/setup/global-setup.ts'],
          // A non-UTC process time zone proves DATETIME values round-trip as UTC.
          env: { TZ: 'Asia/Kolkata' },
          // Integration files share one database, Redis and Elasticsearch, so run them serially.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
