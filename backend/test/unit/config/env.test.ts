import { describe, expect, it } from 'vitest';
import {
  EnvValidationError,
  bullBoardReadOnly,
  googleOAuthConfig,
  parseEnv,
} from '../../../src/config/env';

const validEnv = {
  APP_ORIGIN: 'https://localhost:5173',
  DATABASE_URL: 'mysql://outbox:secret@127.0.0.1:3306/outbox',
  REDIS_URL: 'redis://:secret@127.0.0.1:6379/0',
  ELASTICSEARCH_URL: 'http://127.0.0.1:9200',
  SESSION_SECRET: 's'.repeat(32),
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

function validationIssues(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) return err.issues;
    throw err;
  }
  throw new Error('Expected environment validation to fail');
}

describe('parseEnv', () => {
  it('applies the documented defaults', () => {
    expect(parseEnv(validEnv)).toMatchObject({
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 4000,
      TRUST_PROXY: 1,
      DB_POOL_SIZE: 10,
      SHUTDOWN_GRACE_MS: 25_000,
      BULLMQ_PREFIX: 'outbox',
      ADMIN_EMAILS: [],
      AUTO_PROVISION_SENDERS: 2,
      SMTP_REQUIRE_TLS: true,
      EMAIL_WORKER_CONCURRENCY: 5,
      EMAIL_JOB_ATTEMPTS: 5,
      EMAIL_JOB_BACKOFF_MS: 15_000,
      MAX_EMAILS_PER_HOUR_PER_SENDER: 200,
      MIN_DELAY_BETWEEN_EMAILS_MS: 2_000,
      RATE_LIMIT_WINDOW_MS: 3_600_000,
      MAX_RECIPIENTS_PER_CAMPAIGN: 5_000,
      SEND_LEASE_MS: 90_000,
      UNCERTAIN_DELIVERY_POLICY: 'fail',
      RECONCILE_INTERVAL_MS: 60_000,
    });
  });

  it('coerces numbers and booleans from strings', () => {
    const env = parseEnv({
      ...validEnv,
      API_PORT: '4100',
      EMAIL_WORKER_CONCURRENCY: '12',
      SMTP_REQUIRE_TLS: 'false',
      BULL_BOARD_READ_ONLY: 'true',
    });

    expect(env.API_PORT).toBe(4100);
    expect(env.EMAIL_WORKER_CONCURRENCY).toBe(12);
    expect(env.SMTP_REQUIRE_TLS).toBe(false);
    expect(env.BULL_BOARD_READ_ONLY).toBe(true);
  });

  it('treats empty values as unset so defaults still apply', () => {
    const env = parseEnv({ ...validEnv, API_PORT: '', GOOGLE_CLIENT_ID: '', ADMIN_EMAILS: '' });

    expect(env.API_PORT).toBe(4000);
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.ADMIN_EMAILS).toEqual([]);
  });

  it('parses the admin allowlist into lower-cased emails', () => {
    const env = parseEnv({ ...validEnv, ADMIN_EMAILS: ' Admin@Example.com, ops@example.com ,' });

    expect(env.ADMIN_EMAILS).toEqual(['admin@example.com', 'ops@example.com']);
  });

  it('reports every missing required variable at once', () => {
    expect(validationIssues({ API_PORT: '4000' })).toEqual([
      'APP_ORIGIN: is required',
      'DATABASE_URL: is required',
      'REDIS_URL: is required',
      'ELASTICSEARCH_URL: is required',
      'SESSION_SECRET: is required',
      'ENCRYPTION_KEY: is required',
    ]);
  });

  it('rejects a non-MySQL database URL without echoing its credentials', () => {
    const issues = validationIssues({
      ...validEnv,
      DATABASE_URL: 'postgres://outbox:s3cr3t-value@127.0.0.1:5432/outbox',
    });

    expect(issues).toEqual(['DATABASE_URL: must be a valid URL using mysql:']);
    expect(issues.join('\n')).not.toContain('s3cr3t-value');
  });

  it('requires a 32-byte base64 encryption key and a long session secret', () => {
    const issues = validationIssues({
      ...validEnv,
      ENCRYPTION_KEY: Buffer.alloc(16).toString('base64'),
      SESSION_SECRET: 'short',
    });

    expect(issues).toEqual([
      'SESSION_SECRET: must be at least 32 characters',
      'ENCRYPTION_KEY: must be the base64 encoding of exactly 32 random bytes',
    ]);
  });

  it.each(['https://localhost:5173/', 'https://localhost:5173/app', 'localhost:5173'])(
    'rejects APP_ORIGIN %s because it is not a bare origin',
    (appOrigin) => {
      expect(validationIssues({ ...validEnv, APP_ORIGIN: appOrigin })).toEqual([
        'APP_ORIGIN: must be an origin such as https://localhost:5173 (no path or trailing slash)',
      ]);
    },
  );

  it('rejects out-of-range and unknown values', () => {
    const issues = validationIssues({
      ...validEnv,
      API_PORT: '70000',
      UNCERTAIN_DELIVERY_POLICY: 'maybe',
      FAULT_POINT: 'somewhere',
      RATE_LIMIT_WINDOW_MS: '10',
    });

    expect(issues.map((issue) => issue.split(':')[0]).sort()).toEqual([
      'API_PORT',
      'FAULT_POINT',
      'RATE_LIMIT_WINDOW_MS',
      'UNCERTAIN_DELIVERY_POLICY',
    ]);
  });

  it('requires the Google OAuth settings together', () => {
    expect(validationIssues({ ...validEnv, GOOGLE_CLIENT_ID: 'id' })).toEqual([
      'GOOGLE_CLIENT_ID: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set together',
    ]);
  });
});

describe('googleOAuthConfig', () => {
  it('is null until Google credentials are configured', () => {
    expect(googleOAuthConfig(parseEnv(validEnv))).toBeNull();
  });

  it('returns the client configuration when all three settings are present', () => {
    const env = parseEnv({
      ...validEnv,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_REDIRECT_URI: 'https://localhost:5173/api/auth/google/callback',
    });

    expect(googleOAuthConfig(env)).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://localhost:5173/api/auth/google/callback',
    });
  });
});

describe('bullBoardReadOnly', () => {
  it('defaults to writable in development and read-only elsewhere', () => {
    expect(bullBoardReadOnly(parseEnv(validEnv))).toBe(false);
    expect(bullBoardReadOnly(parseEnv({ ...validEnv, NODE_ENV: 'production' }))).toBe(true);
    expect(bullBoardReadOnly(parseEnv({ ...validEnv, BULL_BOARD_READ_ONLY: 'true' }))).toBe(true);
  });
});
