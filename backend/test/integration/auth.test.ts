import { apiErrorBodySchema } from '@outbox/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users } from '../../src/db/schema';
import { createTestApp, HTTPS, sessionCookie, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { FakeEtherealProvider, FakeGoogleAuthClient, googleIdentity } from '../helpers/fakes';

const ctx = createTestContext();
const google = new FakeGoogleAuthClient();
const app = createTestApp(ctx, { google, ethereal: new FakeEtherealProvider(2525) });

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function startLogin(path = '/api/auth/google') {
  const res = await request(app).get(path).set(HTTPS);
  const location = new URL(res.headers.location as string);
  return { res, cookie: sessionCookie(res) ?? '', state: location.searchParams.get('state') ?? '' };
}

async function sessionKeys() {
  return ctx.redis.keys('test:sess:*');
}

describe('GET /api/auth/google', () => {
  it('redirects to Google and keeps the pending login in a Redis-backed session', async () => {
    const { res, state } = await startLogin('/api/auth/google?returnTo=/sent');

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.google\.test\/auth\?/);
    const setCookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(setCookie).toMatch(/^outbox\.sid=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);

    const keys = await sessionKeys();
    expect(keys).toHaveLength(1);
    expect(await ctx.redis.ttl(keys[0] as string)).toBeGreaterThan(7 * 24 * 3600 - 60);
    const stored = JSON.parse((await ctx.redis.get(keys[0] as string)) ?? '{}');
    expect(stored.oauth).toMatchObject({ state, returnTo: '/sent' });
    expect(stored.oauth.codeVerifier).toEqual(expect.any(String));
    expect(stored.oauth.nonce).toEqual(expect.any(String));
  });

  it('replaces an unsafe returnTo with /', async () => {
    await startLogin('/api/auth/google?returnTo=//evil.example');

    const stored = JSON.parse((await ctx.redis.get((await sessionKeys())[0] as string)) ?? '{}');
    expect(stored.oauth.returnTo).toBe('/');
  });

  it('sends the browser back to /login when Google is not configured', async () => {
    const unconfigured = createTestApp(ctx, { google: null });

    const res = await request(unconfigured).get('/api/auth/google');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://localhost:5173/login?error=oauth_unavailable');
  });
});

describe('GET /api/auth/google/callback', () => {
  it('signs the user in with a new session id and returns them to returnTo', async () => {
    const { cookie: loginCookie, state } = await startLogin('/api/auth/google?returnTo=/sent');
    const identity = googleIdentity({ name: 'Oliver Brown' });
    const code = google.approve(state, identity);

    const res = await request(app)
      .get(`/api/auth/google/callback?code=${code}&state=${state}`)
      .set(HTTPS)
      .set('Cookie', loginCookie);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://localhost:5173/sent');
    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).not.toBe(loginCookie); // regenerated: prevents session fixation
    expect(await sessionKeys()).toHaveLength(1); // the pre-login session was destroyed

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie ?? '');
    const [row] = await ctx.db.select().from(users).where(eq(users.googleSub, identity.sub));
    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      user: {
        id: row?.id,
        name: 'Oliver Brown',
        email: identity.email,
        avatarUrl: identity.picture,
      },
    });
  });

  it.each([
    ['a forged state', (state: string) => `code=anything&state=${state}x`, 'oauth_state'],
    ['a denied consent', (state: string) => `error=access_denied&state=${state}`, 'oauth_denied'],
    ['a missing code', (state: string) => `state=${state}`, 'oauth_failed'],
  ])('rejects %s without creating a session user', async (_label, query, errorCode) => {
    const { cookie, state } = await startLogin();

    const res = await request(app)
      .get(`/api/auth/google/callback?${query(state)}`)
      .set(HTTPS)
      .set('Cookie', cookie);

    expect(res.headers.location).toBe(`https://localhost:5173/login?error=${errorCode}`);
    expect(await ctx.db.select().from(users)).toHaveLength(0);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', sessionCookie(res) ?? cookie);
    expect(me.status).toBe(401);
  });

  it('refuses Google accounts whose email is not verified', async () => {
    const { cookie, state } = await startLogin();
    const code = google.approve(state, googleIdentity({ emailVerified: false }));

    const res = await request(app)
      .get(`/api/auth/google/callback?code=${code}&state=${state}`)
      .set(HTTPS)
      .set('Cookie', cookie);

    expect(res.headers.location).toBe('https://localhost:5173/login?error=email_unverified');
    expect(await ctx.db.select().from(users)).toHaveLength(0);
  });

  it('cannot be replayed: the pending login is single use', async () => {
    const { cookie, state } = await startLogin();
    const identity = googleIdentity();
    const callback = (code: string) =>
      request(app)
        .get(`/api/auth/google/callback?code=${code}&state=${state}`)
        .set(HTTPS)
        .set('Cookie', cookie);
    await callback(google.approve(state, identity));

    const replay = await callback(google.approve(state, identity));

    expect(replay.headers.location).toBe('https://localhost:5173/login?error=oauth_state');
  });

  it('updates the stored profile on a later login', async () => {
    const identity = googleIdentity({ name: 'Old Name' });
    await signIn(app, google, identity);
    await signIn(app, google, { ...identity, name: 'New Name' });

    const rows = await ctx.db.select().from(users);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('New Name');
  });
});

describe('authenticated routes', () => {
  it.each([
    ['GET', '/api/auth/me'],
    ['GET', '/api/senders'],
    ['POST', '/api/campaigns'],
    ['GET', '/api/emails?folder=scheduled'],
    ['GET', '/api/emails/counts'],
  ])('%s %s answers 401 without a session', async (method, path) => {
    const res = await request(app)[method === 'GET' ? 'get' : 'post'](path);

    expect(res.status).toBe(401);
    expect(apiErrorBodySchema.parse(res.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('logs out a session whose user no longer exists', async () => {
    const cookie = await signIn(app, google, googleIdentity());
    await ctx.db.delete(users);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);

    expect(res.status).toBe(401);
    expect(await sessionKeys()).toHaveLength(0);
  });
});

describe('POST /api/auth/logout', () => {
  it('destroys the Redis session and clears the cookie', async () => {
    const cookie = await signIn(app, google, googleIdentity());

    const res = await request(app).post('/api/auth/logout').set(HTTPS).set('Cookie', cookie);

    expect(res.status).toBe(204);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(
      /^outbox\.sid=;.*Expires=Thu, 01 Jan 1970/,
    );
    expect(await sessionKeys()).toHaveLength(0);
    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});
