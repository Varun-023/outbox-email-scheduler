import type { Express } from 'express';
import request from 'supertest';
import { createApiModules, type ApiOverrides } from '../../src/api';
import { createApp } from '../../src/app';
import type { GoogleIdentity } from '../../src/modules/auth/google-client';
import type { TestContext } from './context';
import type { FakeGoogleAuthClient } from './fakes';

export function createTestApp(ctx: TestContext, overrides: ApiOverrides = {}): Express {
  return createApp({
    config: ctx.env,
    logger: ctx.logger,
    healthChecks: [],
    api: createApiModules(
      ctx.env,
      {
        db: ctx.db,
        redis: ctx.redis,
        queues: ctx.queues,
        elasticsearch: ctx.elasticsearch,
      },
      ctx.logger,
      overrides,
    ),
  });
}

/** The Vite proxy marks requests as HTTPS; mimic it so Secure cookies are issued. */
export const HTTPS = { 'X-Forwarded-Proto': 'https' };

/** Extracts `outbox.sid=...` from a response's Set-Cookie header. */
export function sessionCookie(res: request.Response): string | undefined {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header?.find((cookie) => cookie.startsWith('outbox.sid='))?.split(';')[0];
}

/** Runs the real login flow against the fake Google client and returns the session cookie. */
export async function signIn(
  app: Express,
  google: FakeGoogleAuthClient,
  identity: GoogleIdentity,
): Promise<string> {
  const start = await request(app).get('/api/auth/google').set(HTTPS);
  const loginCookie = sessionCookie(start);
  const state = new URL(start.headers.location as string).searchParams.get('state') ?? '';
  const code = google.approve(state, identity);

  const callback = await request(app)
    .get(`/api/auth/google/callback?code=${code}&state=${state}`)
    .set(HTTPS)
    .set('Cookie', loginCookie ?? '');
  const cookie = sessionCookie(callback);
  if (callback.status !== 302 || !cookie || callback.headers.location?.includes('error')) {
    throw new Error(`Sign-in failed: ${callback.status} ${callback.headers.location}`);
  }
  return cookie;
}
