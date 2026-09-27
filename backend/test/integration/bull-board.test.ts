import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { FakeEtherealProvider, FakeGoogleAuthClient, googleIdentity } from '../helpers/fakes';
import { TEST_ADMIN_EMAIL } from '../helpers/test-env';

const ctx = createTestContext();
const google = new FakeGoogleAuthClient();
const app = createTestApp(ctx, { google, ethereal: new FakeEtherealProvider(2525) });

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

describe('Bull Board at /admin/queues', () => {
  it('requires a signed-in session', async () => {
    const res = await request(app).get('/admin/queues');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses signed-in users who are not on the ADMIN_EMAILS allowlist', async () => {
    const cookie = await signIn(app, google, googleIdentity());

    const page = await request(app).get('/admin/queues').set('Cookie', cookie);
    const api = await request(app).get('/admin/queues/api/queues').set('Cookie', cookie);

    expect(page.status).toBe(403);
    expect(page.body.error.code).toBe('FORBIDDEN');
    expect(api.status).toBe(403);
  });

  it('serves the dashboard and all four queues to an allow-listed admin', async () => {
    const cookie = await signIn(app, google, googleIdentity({ email: TEST_ADMIN_EMAIL }));

    const page = await request(app).get('/admin/queues').set('Cookie', cookie);
    const api = await request(app).get('/admin/queues/api/queues').set('Cookie', cookie);

    expect(page.status).toBe(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(api.status).toBe(200);
    expect(api.body.queues.map((queue: { name: string }) => queue.name).sort()).toEqual([
      'emails',
      'maintenance',
      'notifications',
      'search-sync',
    ]);
  });
});
