import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { users, type UserRow } from '../../src/db/schema';
import { newId } from '../../src/lib/ids';
import { EmailsRepository } from '../../src/modules/emails/emails.repository';
import { createTestApp, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { createCampaign, createSender } from '../helpers/factories';
import { FakeEtherealProvider, FakeGoogleAuthClient, googleIdentity } from '../helpers/fakes';

const ctx = createTestContext();
const google = new FakeGoogleAuthClient();
const app = createTestApp(ctx, { google, ethereal: new FakeEtherealProvider(2525) });
const repository = new EmailsRepository(ctx.db);

let cookie: string;
let user: UserRow;

async function signedInUser() {
  const identity = googleIdentity();
  const sessionCookie = await signIn(app, google, identity);
  const [row] = await ctx.db.select().from(users).where(eq(users.googleSub, identity.sub));
  return { cookie: sessionCookie, user: row as UserRow };
}

beforeEach(async () => {
  await ctx.reset();
  ({ cookie, user } = await signedInUser());
});
afterAll(() => ctx.close());

const base = Date.parse('2026-10-01T09:00:00.000Z');
const at = (minutes: number) => new Date(base + minutes * 60_000);

async function fixture(owner: UserRow, count: number) {
  const sender = await createSender(ctx.db, ctx.secrets, { userId: owner.id, smtpPort: 2525 });
  return createCampaign(ctx.db, {
    user: owner,
    sender,
    recipients: Array.from({ length: count }, (_, i) => `r${i}@example.com`),
    scheduledAt: (i) => at(count - i), // inserted out of order on purpose
  });
}

async function complete(emailId: string, outcome: 'sent' | 'failed', completedAt: Date) {
  const token = newId();
  await repository.claim(emailId, token, new Date(Date.now() + 60_000));
  if (outcome === 'sent') {
    await repository.markSent(emailId, token, {
      messageId: `<${emailId}@test>`,
      response: '250 OK',
      previewUrl: null,
      sentAt: completedAt,
    });
  } else {
    await repository.markFailed(
      emailId,
      token,
      'SMTP_PERMANENT',
      '550 Mailbox unavailable',
      completedAt,
    );
  }
}

const list = (query: string, as = cookie) =>
  request(app).get(`/api/emails?${query}`).set('Cookie', as);

describe('GET /api/emails', () => {
  it('pages through the scheduled folder in send order', async () => {
    const { emails } = await fixture(user, 5);

    const page1 = await list('folder=scheduled&limit=2');
    const page2 = await list(`folder=scheduled&limit=2&cursor=${page1.body.nextCursor}`);
    const page3 = await list(`folder=scheduled&limit=2&cursor=${page2.body.nextCursor}`);

    const byTime = [...emails].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
    expect(
      [...page1.body.items, ...page2.body.items, ...page3.body.items].map((e) => e.id),
    ).toEqual(byTime.map((e) => e.id));
    expect(page3.body.nextCursor).toBeNull();
    expect(page1.body.items[0]).toEqual({
      id: byTime[0]?.id,
      campaignId: byTime[0]?.campaignId,
      to: byTime[0]?.recipientEmail,
      toName: null,
      subject: 'Meeting follow-up',
      preview: 'Hi, just following up on our meeting.',
      status: 'scheduled',
      scheduledAt: byTime[0]?.scheduledAt.toISOString(),
      sentAt: null,
      completedAt: null,
      deferCount: 0,
      lastDeferredReason: null,
      sender: { id: byTime[0]?.senderId, fromEmail: expect.stringMatching(/@ethereal\.test$/) },
    });
  });

  it('lists sent and failed emails newest first, with a status filter', async () => {
    const { emails } = await fixture(user, 3);
    await complete(emails[0]!.id, 'sent', at(10));
    await complete(emails[1]!.id, 'failed', at(30));
    await complete(emails[2]!.id, 'sent', at(20));

    const all = await list('folder=sent');
    const failed = await list('folder=sent&status=failed');

    expect(all.body.items.map((e: { id: string }) => e.id)).toEqual([
      emails[1]!.id,
      emails[2]!.id,
      emails[0]!.id,
    ]);
    expect(all.body.items[0]).toMatchObject({
      status: 'failed',
      completedAt: at(30).toISOString(),
    });
    expect(all.body.items[1]).toMatchObject({ status: 'sent', sentAt: at(20).toISOString() });
    expect(failed.body.items.map((e: { id: string }) => e.id)).toEqual([emails[1]!.id]);
    expect((await list('folder=scheduled')).body.items).toEqual([]);
  });

  it('filters rescheduled emails', async () => {
    const { emails } = await fixture(user, 2);
    await repository.defer(emails[0]!.id, at(120), 'sender_hourly_limit');

    const res = await list('folder=scheduled&rescheduled=true');

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: emails[0]!.id,
      deferCount: 1,
      lastDeferredReason: 'sender_hourly_limit',
    });
  });

  it("never shows another user's emails", async () => {
    const other = await signedInUser();
    await fixture(other.user, 2);

    expect((await list('folder=scheduled')).body.items).toEqual([]);
    expect((await list('folder=scheduled', other.cookie)).body.items).toHaveLength(2);
  });

  it.each([
    ['', 'folder'],
    ['folder=inbox', 'folder'],
    ['folder=scheduled&status=sent', 'status'],
    ['folder=sent&cursor=not-a-cursor', 'cursor'],
    ['folder=sent&limit=500', 'limit'],
  ])('rejects %j (%s)', async (query, path) => {
    const res = await list(query);

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  });
});

describe('GET /api/emails/counts', () => {
  it('counts both folders for the signed-in user only', async () => {
    const { emails } = await fixture(user, 4);
    await complete(emails[0]!.id, 'sent', at(5));
    await complete(emails[1]!.id, 'failed', at(6));
    await fixture((await signedInUser()).user, 3);

    const res = await request(app).get('/api/emails/counts').set('Cookie', cookie);

    expect(res.body).toEqual({ scheduled: 2, sent: 2 });
  });
});

describe('GET /api/emails/:id', () => {
  it('returns the email with its body and delivery details', async () => {
    const { emails, campaign } = await fixture(user, 1);
    await complete(emails[0]!.id, 'sent', at(1));

    const res = await request(app).get(`/api/emails/${emails[0]!.id}`).set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: emails[0]!.id,
      status: 'sent',
      bodyHtml: campaign.bodyHtml,
      fromName: 'Test Sender',
      attemptCount: 1,
      messageId: `<${emails[0]!.id}@test>`,
      errorCode: null,
      originalScheduledAt: emails[0]!.originalScheduledAt.toISOString(),
      campaign: {
        id: campaign.id,
        effectiveDelaySeconds: 0,
        effectiveHourlyLimit: 1_000,
        recipientCount: 1,
      },
    });
  });

  it("answers 404 for another user's email and 400 for a malformed id", async () => {
    const other = await signedInUser();
    const { emails } = await fixture(other.user, 1);

    const hidden = await request(app).get(`/api/emails/${emails[0]!.id}`).set('Cookie', cookie);
    const malformed = await request(app).get('/api/emails/not-a-uuid').set('Cookie', cookie);

    expect(hidden.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});
