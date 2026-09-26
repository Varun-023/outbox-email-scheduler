import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { createHealthRouter, type DependencyCheck } from '../../src/modules/health/health.routes';

const logger = pino({ level: 'silent' });
const passing = async () => {};
const failing = async () => {
  throw new Error('connection refused');
};

function appWith(checks: DependencyCheck[]) {
  return createApp({ config: { TRUST_PROXY: 1 }, logger, healthChecks: checks });
}

const allHealthy: DependencyCheck[] = [
  { name: 'mysql', critical: true, check: passing },
  { name: 'redis', critical: true, check: passing },
  { name: 'elasticsearch', critical: false, check: passing },
];

describe('createApp', () => {
  it('serves liveness without touching dependencies', async () => {
    const neverCalled: DependencyCheck = {
      name: 'mysql',
      critical: true,
      check: () => Promise.reject(new Error('liveness must not run readiness checks')),
    };

    const res = await request(appWith([neverCalled])).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', uptimeSec: expect.any(Number) });
  });

  it('sets a request id and hides the X-Powered-By header', async () => {
    const res = await request(appWith(allHealthy)).get('/api/health');

    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('answers unknown API routes with the JSON error envelope', async () => {
    const res = await request(appWith(allHealthy)).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects malformed JSON before routing', async () => {
    const res = await request(appWith(allHealthy))
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('GET /api/health/ready', () => {
  it('is ok when every dependency responds', async () => {
    const res = await request(appWith(allHealthy)).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      checks: { mysql: 'ok', redis: 'ok', elasticsearch: 'ok' },
    });
  });

  it('stays ready but degraded when only a non-critical dependency fails', async () => {
    const res = await request(
      appWith([
        { name: 'mysql', critical: true, check: passing },
        { name: 'elasticsearch', critical: false, check: failing },
      ]),
    ).get('/api/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { mysql: 'ok', elasticsearch: 'degraded' },
    });
  });

  it('is unavailable (503) when a critical dependency fails, without leaking the error', async () => {
    const res = await request(
      appWith([
        { name: 'mysql', critical: true, check: failing },
        { name: 'redis', critical: true, check: passing },
        { name: 'elasticsearch', critical: false, check: failing },
      ]),
    ).get('/api/health/ready');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: 'unavailable',
      checks: { mysql: 'down', redis: 'ok', elasticsearch: 'degraded' },
    });
    expect(res.text).not.toContain('connection refused');
  });

  it('treats a dependency that never answers as down once the timeout passes', async () => {
    const app = express();
    app.use(pinoHttp({ logger }));
    app.use(
      createHealthRouter({
        timeoutMs: 50,
        checks: [{ name: 'mysql', critical: true, check: () => new Promise(() => {}) }],
      }),
    );

    const startedAt = Date.now();
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ mysql: 'down' });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
