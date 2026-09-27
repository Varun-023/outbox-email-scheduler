import { parseEnv, type Env } from '../../src/config/env';

/**
 * Reads variables that integration tests need, failing with setup instructions
 * rather than an opaque connection error when one is missing.
 */
export function requireTestEnv<const K extends string>(names: readonly K[]): Record<K, string> {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')}. Copy .env.example to .env, fill it in, and run \`npm run infra:up\`.`,
    );
  }
  return Object.fromEntries(names.map((name) => [name, process.env[name] as string])) as Record<
    K,
    string
  >;
}

/** A fixed 32-byte key so encrypted fixtures are readable across test processes. */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_ADMIN_EMAIL = 'admin@example.com';

/**
 * Environment for integration tests and child worker processes: the test database,
 * Redis db 1 under the "test" prefix, and short timings so recovery paths run in seconds.
 */
export function integrationEnvVars(overrides: Record<string, string> = {}): Record<string, string> {
  const base = requireTestEnv(['DATABASE_URL_TEST', 'REDIS_URL_TEST', 'ELASTICSEARCH_URL']);
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_ORIGIN: 'https://localhost:5173',
    DATABASE_URL: base.DATABASE_URL_TEST,
    REDIS_URL: base.REDIS_URL_TEST,
    ELASTICSEARCH_URL: base.ELASTICSEARCH_URL,
    BULLMQ_PREFIX: 'test',
    SESSION_SECRET: 'integration-test-session-secret-0123456789',
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ADMIN_EMAILS: TEST_ADMIN_EMAIL,
    SMTP_REQUIRE_TLS: 'false',
    SMTP_CONNECTION_TIMEOUT_MS: '2000',
    SMTP_SOCKET_TIMEOUT_MS: '5000',
    EMAIL_JOB_ATTEMPTS: '3',
    EMAIL_JOB_BACKOFF_MS: '200',
    EMAIL_WORKER_CONCURRENCY: '5',
    EMAIL_WORKER_LOCK_DURATION_MS: '2000',
    EMAIL_WORKER_STALLED_INTERVAL_MS: '1000',
    SEND_LEASE_MS: '3000',
    MIN_DELAY_BETWEEN_EMAILS_MS: '0',
    RECONCILE_INTERVAL_MS: '0',
    AUTO_PROVISION_SENDERS: '2',
    SLACK_CLIENT_ID: 'test-slack-client-id',
    SLACK_CLIENT_SECRET: 'test-slack-client-secret',
    SLACK_REDIRECT_URI: 'https://localhost:5173/api/integrations/slack/callback',
    ...overrides,
  };
}

export function integrationEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv(integrationEnvVars(overrides));
}
