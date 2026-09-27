import { senders } from '../../src/db/schema';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { FakeEtherealProvider, FakeGoogleAuthClient, googleIdentity } from '../helpers/fakes';

const ctx = createTestContext();
const google = new FakeGoogleAuthClient();
let ethereal: FakeEtherealProvider;
let app: ReturnType<typeof createTestApp>;

beforeEach(async () => {
  await ctx.reset();
  ethereal = new FakeEtherealProvider(2525);
  app = createTestApp(ctx, { google, ethereal });
});
afterAll(() => ctx.close());

const listSenders = (cookie: string) => request(app).get('/api/senders').set('Cookie', cookie);

describe('GET /api/senders', () => {
  it('provisions two Ethereal senders on first use and reuses them afterwards', async () => {
    const identity = googleIdentity({ name: 'Oliver Brown' });
    const cookie = await signIn(app, google, identity);

    const first = await listSenders(cookie);
    const second = await listSenders(cookie);

    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.items[0]).toEqual({
      id: expect.any(String),
      label: 'Ethereal sender 1',
      fromName: 'Oliver Brown',
      fromEmail: expect.stringMatching(/@ethereal\.test$/),
      provider: 'ethereal',
      hourlyLimit: 200,
      minDelayMs: 0,
    });
    expect(second.body).toEqual(first.body);
    expect(ethereal.created).toBe(2);
  });

  it('never returns SMTP credentials, and stores the password encrypted', async () => {
    const cookie = await signIn(app, google, googleIdentity());

    const res = await listSenders(cookie);
    const [row] = await ctx.db.select().from(senders);

    expect(res.text).not.toMatch(/smtp|pass|secret/i);
    expect(row?.smtpPassEnc).toMatch(/^v1:/);
    expect(ctx.secrets.decrypt(row?.smtpPassEnc ?? '')).toMatch(/^secret-/);
  });

  it('creates exactly two senders when first requests race each other', async () => {
    const cookie = await signIn(app, google, googleIdentity());
    ethereal.delayMs = 150;

    const responses = await Promise.all(Array.from({ length: 5 }, () => listSenders(cookie)));

    expect(responses.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
    const ids = new Set(
      responses.flatMap((res) => res.body.items.map((s: { id: string }) => s.id)),
    );
    expect(ids.size).toBe(2);
    expect(ethereal.created).toBe(2);
    expect(await ctx.db.select().from(senders)).toHaveLength(2);
  });

  it('answers 503 when Ethereal is unavailable and succeeds on retry', async () => {
    const cookie = await signIn(app, google, googleIdentity());
    ethereal.failNext = 1;

    const failed = await listSenders(cookie);
    const retried = await listSenders(cookie);

    expect(failed.status).toBe(503);
    expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(retried.status).toBe(200);
    expect(retried.body.items).toHaveLength(2);
  });

  it("only lists the signed-in user's own senders", async () => {
    const alice = await signIn(app, google, googleIdentity());
    const bob = await signIn(app, google, googleIdentity());

    const aliceIds = (await listSenders(alice)).body.items.map((s: { id: string }) => s.id);
    const bobIds = (await listSenders(bob)).body.items.map((s: { id: string }) => s.id);

    expect(aliceIds).toHaveLength(2);
    expect(bobIds).toHaveLength(2);
    expect(aliceIds.filter((id: string) => bobIds.includes(id))).toEqual([]);
  });
});
