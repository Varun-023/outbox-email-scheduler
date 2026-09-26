import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../../src/config/env';

const validEnv = {
  APP_ORIGIN: 'https://localhost:5173',
  DATABASE_URL: 'mysql://outbox:secret@127.0.0.1:3306/outbox',
  REDIS_URL: 'redis://:secret@127.0.0.1:6379/0',
  ELASTICSEARCH_URL: 'http://127.0.0.1:9200',
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
  it('applies defaults to optional settings', () => {
    expect(parseEnv(validEnv)).toEqual({
      ...validEnv,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
      API_PORT: 4000,
      TRUST_PROXY: 1,
      DB_POOL_SIZE: 10,
      SHUTDOWN_GRACE_MS: 25_000,
    });
  });

  it('coerces numeric settings from strings', () => {
    const env = parseEnv({ ...validEnv, API_PORT: '4100', DB_POOL_SIZE: '4', TRUST_PROXY: '0' });

    expect(env.API_PORT).toBe(4100);
    expect(env.DB_POOL_SIZE).toBe(4);
    expect(env.TRUST_PROXY).toBe(0);
  });

  it('treats empty values as unset so defaults still apply', () => {
    const env = parseEnv({ ...validEnv, API_PORT: '', LOG_LEVEL: '' });

    expect(env.API_PORT).toBe(4000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('ignores unrelated variables', () => {
    const env = parseEnv({ ...validEnv, PATH: '/usr/bin', GOOGLE_CLIENT_ID: 'abc' });

    expect(env).not.toHaveProperty('PATH');
    expect(env).not.toHaveProperty('GOOGLE_CLIENT_ID');
  });

  it('reports every missing required variable at once', () => {
    expect(validationIssues({ API_PORT: '4000' })).toEqual([
      'APP_ORIGIN: is required',
      'DATABASE_URL: is required',
      'REDIS_URL: is required',
      'ELASTICSEARCH_URL: is required',
    ]);
  });

  it('reports blank required variables as missing', () => {
    expect(validationIssues({ ...validEnv, DATABASE_URL: '' })).toEqual([
      'DATABASE_URL: is required',
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

  it('accepts TLS variants of the Redis and Elasticsearch URLs', () => {
    const env = parseEnv({
      ...validEnv,
      REDIS_URL: 'rediss://:secret@redis.example.com:6380/0',
      ELASTICSEARCH_URL: 'https://search.example.com',
    });

    expect(env.REDIS_URL).toBe('rediss://:secret@redis.example.com:6380/0');
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
      LOG_LEVEL: 'verbose',
      NODE_ENV: 'staging',
    });

    expect(issues).toHaveLength(3);
    expect(issues.map((issue) => issue.split(':')[0])).toEqual([
      'NODE_ENV',
      'LOG_LEVEL',
      'API_PORT',
    ]);
  });
});
