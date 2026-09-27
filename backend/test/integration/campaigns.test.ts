import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, emails } from '../../src/db/schema';
import { newId } from '../../src/lib/ids';
import { CampaignsRepository } from '../../src/modules/campaigns/campaigns.repository';
import { EmailsRepository } from '../../src/modules/emails/emails.repository';
import { createQueues, emailJobId } from '../../src/queue/queues';
import { closeRedisConnection, createRedisConnection } from '../../src/queue/redis';
import { reconcile } from '../../src/workers/reconcile';
import { SendReceiptStore } from '../../src/workers/send-receipts';
import { createTestApp, signIn } from '../helpers/app';
import { createTestContext } from '../helpers/context';
import { FakeEtherealProvider, FakeGoogleAuthClient, googleIdentity } from '../helpers/fakes';

const ctx = createTestContext({
  MAX_RECIPIENTS_PER_CAMPAIGN: '50',
  RATE_LIMIT_WINDOW_MS: '3600000',
});
const google = new FakeGoogleAuthClient();
const app = createTestApp(ctx, { google, ethereal: new FakeEtherealProvider(2525) });

let cookie: string;
let senderId: string;

beforeEach(async () => {
  await ctx.reset();
  cookie = await signIn(app, google, googleIdentity());
  senderId = (await request(app).get('/api/senders').set('Cookie', cookie)).body.items[0].id;
});
afterAll(() => ctx.close());

function body(overrides: Record<string, unknown> = {}) {
  return {
    senderId,
    subject: 'Meeting follow-up',
    bodyHtml: '<p>Hi, just wanted to follow up on our meeting.</p>',
    recipients: [{ email: 'john@example.com', name: 'John Smith' }, { email: 'olive@example.com' }],
    ...overrides,
  };
}

function post(payload: object, key: string | null = newId(), as = cookie) {
  const req = request(app).post('/api/campaigns').set('Cookie', as);
  return key === null ? req.send(payload) : req.set('Idempotency-Key', key).send(payload);
}

const campaignCount = async () => (await ctx.db.select().from(campaigns)).length;

describe('POST /api/campaigns: scheduling', () => {
  it('stores the emails and schedules one delayed BullMQ job per recipient', async () => {
    // Top of an hour, two hours ahead, so the plan is easy to read.
    const hour = 3_600_000;
    const startAt = new Date(Math.ceil(Date.now() / hour) * hour + hour);
    const recipients = ['a@example.com', 'b@example.com', 'c@example.com'].map((email) => ({
      email,
    }));

    const res = await post(
      body({
        recipients,
        startAt: startAt.toISOString(),
        delayBetweenEmailsSeconds: 5,
        hourlyLimit: 2,
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      campaign: {
        id: expect.any(String),
        senderId,
        subject: 'Meeting follow-up',
        recipientCount: 3,
        startAt: startAt.toISOString(),
        effectiveDelaySeconds: 5,
        effectiveHourlyLimit: 2,
        firstScheduledAt: startAt.toISOString(),
        lastScheduledAt: new Date(startAt.getTime() + hour).toISOString(),
        queueStatus: 'queued',
        createdAt: expect.any(String),
      },
      recipients: { accepted: 3, duplicatesRemoved: 0 },
    });

    const rows = await ctx.db
      .select()
      .from(emails)
      .where(eq(emails.campaignId, res.body.campaign.id));
    rows.sort((a, b) => a.seqNo - b.seqNo);
    expect(
      rows.map((row) => [row.recipientEmail, row.status, row.scheduledAt.toISOString()]),
    ).toEqual([
      ['a@example.com', 'scheduled', startAt.toISOString()],
      ['b@example.com', 'scheduled', new Date(startAt.getTime() + 5_000).toISOString()],
      ['c@example.com', 'scheduled', new Date(startAt.getTime() + hour).toISOString()],
    ]);

    for (const row of rows) {
      const job = await ctx.queues.emails.getJob(emailJobId(row.id));
      expect(job?.id).toBe(`email-${row.id}`);
      expect(await job?.getState()).toBe('delayed');
      expect(job?.data).toEqual({
        emailId: row.id,
        campaignId: row.campaignId,
        senderId,
        userId: row.userId,
        to: row.recipientEmail,
      });
      expect((job?.timestamp ?? 0) + (job?.opts.delay ?? 0)).toBeCloseTo(
        row.scheduledAt.getTime(),
        -3,
      );
    }
    const [campaign] = await ctx.db.select().from(campaigns);
    expect(campaign?.enqueuedAt).toBeInstanceOf(Date);
  });

  it('stores sanitised HTML with a plain-text part and a preview', async () => {
    const res = await post(
      body({ bodyHtml: '<p onclick="x()">Hello <b>there</b></p><script>alert(1)</script>' }),
    );

    const [row] = await ctx.db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, res.body.campaign.id));
    expect(row).toMatchObject({
      bodyHtml: '<p>Hello <b>there</b></p>',
      bodyText: 'Hello there',
      previewText: 'Hello there',
    });
  });

  it('removes duplicate recipients and reports how many', async () => {
    const res = await post(
      body({
        recipients: [
          { email: 'tame@jmail.com' },
          { email: 'TAME@jmail.com' },
          { email: 'lame@jmail.com' },
          { email: 'Tame <tame@jmail.com>' },
        ],
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.recipients).toEqual({ accepted: 2, duplicatesRemoved: 2 });
    const rows = await ctx.db.select().from(emails);
    expect(rows.map((row) => row.recipientEmail).sort()).toEqual([
      'lame@jmail.com',
      'tame@jmail.com',
    ]);
  });
});

describe('POST /api/campaigns: idempotency', () => {
  it('replays an identical request with the same Idempotency-Key', async () => {
    const key = newId();
    const first = await post(body(), key);

    const replay = await post(body(), key);

    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await campaignCount()).toBe(1);
    expect(await ctx.db.select().from(emails)).toHaveLength(2);
  });

  it('rejects the same key with a different request', async () => {
    const key = newId();
    await post(body(), key);

    const res = await post(body({ subject: 'Something else' }), key);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await campaignCount()).toBe(1);
  });

  it('creates exactly one campaign when duplicate submissions race', async () => {
    const key = newId();

    const responses = await Promise.all(Array.from({ length: 5 }, () => post(body(), key)));

    expect(responses.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(new Set(responses.map((res) => res.body.campaign.id)).size).toBe(1);
    expect(await campaignCount()).toBe(1);
    expect(await ctx.db.select().from(emails)).toHaveLength(2);
    expect(await ctx.queues.emails.getJobCountByTypes('delayed', 'waiting')).toBe(2);
  });

  it('treats different keys as different campaigns', async () => {
    await post(body(), newId());
    await post(body(), newId());

    expect(await campaignCount()).toBe(2);
  });
});

describe('POST /api/campaigns: validation', () => {
  it('requires an Idempotency-Key header', async () => {
    const res = await post(body(), null);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      { path: 'Idempotency-Key', message: 'Idempotency-Key header is required' },
    ]);
  });

  it('lists invalid recipient addresses with their positions', async () => {
    const res = await post(
      body({ recipients: [{ email: 'ok@example.com' }, { email: 'nope' }, { email: 'a@b' }] }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: '2 recipient address(es) are invalid',
      details: [
        { path: 'recipients[1].email', message: 'Invalid email address' },
        { path: 'recipients[2].email', message: 'Invalid email address' },
      ],
    });
  });

  it.each([
    ['an hourly limit above the sender limit', { hourlyLimit: 201 }, 'hourlyLimit'],
    ['a start time in the past', { startAt: '2020-01-01T00:00:00Z' }, 'startAt'],
    ['a start time beyond 90 days', { startAt: '2099-01-01T00:00:00Z' }, 'startAt'],
    ['a body without text', { bodyHtml: '<script>alert(1)</script>' }, 'bodyHtml'],
    ['an unknown field', { cc: 'x@example.com' }, ''],
    [
      'too many recipients',
      { recipients: Array.from({ length: 51 }, (_, i) => ({ email: `r${i}@example.com` })) },
      'recipients',
    ],
  ])('rejects %s', async (_label, overrides, path) => {
    const res = await post(body(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
    expect(await campaignCount()).toBe(0);
  });

  it("answers 404 for another user's sender", async () => {
    const other = await signIn(app, google, googleIdentity());
    const othersSender = (await request(app).get('/api/senders').set('Cookie', other)).body.items[0]
      .id;

    const res = await post(body({ senderId: othersSender }));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('POST /api/campaigns when Redis is unavailable', () => {
  it('commits to MySQL, answers queueStatus "pending", and recovery enqueues later', async () => {
    const deadRedis = createRedisConnection('redis://127.0.0.1:1', ctx.logger, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    const deadQueues = createQueues(deadRedis, {
      prefix: 'test',
      emailJobAttempts: 3,
      emailJobBackoffMs: 200,
    });
    for (const queue of Object.values(deadQueues) as Queue[]) queue.on('error', () => {});
    const degradedApp = createTestApp(
      { ...ctx, queues: deadQueues },
      { google, ethereal: new FakeEtherealProvider(2525) },
    );

    const res = await request(degradedApp)
      .post('/api/campaigns')
      .set('Cookie', cookie)
      .set('Idempotency-Key', newId())
      .send(body());

    expect(res.status).toBe(201);
    expect(res.body.campaign.queueStatus).toBe('pending');
    const [pending] = await ctx.db.select().from(campaigns);
    expect(pending?.enqueuedAt).toBeNull();
    await closeRedisConnection(deadRedis);

    const report = await reconcile(
      {
        emails: new EmailsRepository(ctx.db),
        campaigns: new CampaignsRepository(ctx.db),
        emailQueue: ctx.queues.emails,
        receipts: new SendReceiptStore(ctx.redis, 'test'),
        redis: ctx.redis,
        keyPrefix: 'test',
        uncertainPolicy: 'fail',
        notEnqueuedGraceMs: 0,
        logger: ctx.logger,
      },
      { fullSweep: false },
    );

    expect(report.campaignsEnqueued).toBe(1);
    const [recovered] = await ctx.db.select().from(campaigns);
    expect(recovered?.enqueuedAt).toBeInstanceOf(Date);
    expect(await ctx.queues.emails.getJobCountByTypes('delayed', 'waiting')).toBe(2);
  });
});
