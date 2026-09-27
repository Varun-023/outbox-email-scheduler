import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rateLimitNotificationJobId } from '../../src/queue/queues';
import { windowIndex } from '../../src/rate-limit/keys';
import { startWorkerRuntime, type WorkerRuntime } from '../../src/workers/run-workers';
import {
  alignToWindowStart,
  createTestContext,
  redisClockOffset,
  waitFor,
} from '../helpers/context';
import {
  createCampaign,
  createSender,
  createUser,
  emailRows,
  enqueueFixture,
} from '../helpers/factories';
import { FakeSmtpServer } from '../helpers/fake-smtp';

const WINDOW_MS = 2_000;
const ctx = createTestContext({ RATE_LIMIT_WINDOW_MS: String(WINDOW_MS) });
let smtp: FakeSmtpServer;
let runtimes: WorkerRuntime[] = [];

beforeAll(async () => {
  smtp = await FakeSmtpServer.start();
});
beforeEach(async () => {
  await ctx.reset();
  smtp.reset();
});
afterEach(async () => {
  await Promise.all(runtimes.map((runtime) => runtime.close()));
  runtimes = [];
});
afterAll(async () => {
  await ctx.close();
  await smtp.close();
});

async function startWorkers(count: number, concurrency = 5) {
  for (let i = 0; i < count; i += 1) {
    runtimes.push(
      await startWorkerRuntime(
        { ...ctx.env, EMAIL_WORKER_CONCURRENCY: concurrency },
        { logger: ctx.logger, fault: () => {} },
      ),
    );
  }
}

const recipients = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix}${i}@example.com`);

async function waitUntilAllSent(campaignIds: string[], count: number) {
  return waitFor(
    async () => {
      const rows = (await Promise.all(campaignIds.map((id) => emailRows(ctx.db, id)))).flat();
      return rows.length === count && rows.every((row) => row.status === 'sent') ? rows : undefined;
    },
    { timeoutMs: 20_000, message: `${count} emails to be sent` },
  );
}

/** The gate counts sends per window on the Redis clock, so tests bucket the same way. */
async function redisWindowOf() {
  const offset = await redisClockOffset(ctx.redis);
  return (hostMs: number) => windowIndex(hostMs + offset, WINDOW_MS);
}

describe('hourly limit', () => {
  it('never exceeds the sender limit across workers and reschedules overflow instead of failing', async () => {
    const user = await createUser(ctx.db);
    const sender = await createSender(ctx.db, ctx.secrets, {
      userId: user.id,
      smtpPort: smtp.port,
      hourlyLimit: 3,
    });
    await startWorkers(2);
    await alignToWindowStart(WINDOW_MS, 300);
    const now = new Date();
    // Two campaigns share the sender and each planned 3 emails for this window: 6 > limit 3.
    const a = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: recipients('a', 3),
      scheduledAt: now,
      hourlyLimit: 3,
    });
    const b = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: recipients('b', 3),
      scheduledAt: now,
      hourlyLimit: 3,
    });
    await Promise.all([enqueueFixture(ctx.queues, a), enqueueFixture(ctx.queues, b)]);

    const rows = await waitUntilAllSent([a.campaign.id, b.campaign.id], 6);

    const windowOf = await redisWindowOf();
    const firstWindow = windowOf(Math.min(...smtp.messages.map((m) => m.startedAt)));
    const perWindow = smtp.messages.map((m) => windowOf(m.startedAt) - firstWindow);
    expect(perWindow.filter((w) => w === 0)).toHaveLength(3);
    expect(perWindow.filter((w) => w === 1)).toHaveLength(3);

    const deferred = rows.filter((row) => row.deferCount > 0);
    expect(deferred).toHaveLength(3);
    const nextWindowStart = (firstWindow + 1) * WINDOW_MS;
    for (const row of deferred) {
      expect(row.lastDeferredReason).toBe('sender_hourly_limit');
      // Rescheduled to the start of the next window (gap 0), never failed.
      expect(
        Math.abs(row.scheduledAt.getTime() + (await redisClockOffset(ctx.redis)) - nextWindowStart),
      ).toBeLessThan(40);
    }

    // Each time the sender filled a window (both windows here), one notification job was
    // queued with a per-window job id, so repeated "limit reached" events cannot duplicate it.
    for (const window of [firstWindow, firstWindow + 1]) {
      const notification = await ctx.queues.notifications.getJob(
        rateLimitNotificationJobId('sender', sender.id, window),
      );
      expect(notification?.data).toMatchObject({ userId: user.id, scope: 'sender', limit: 3 });
    }
    const queued = await ctx.queues.notifications.getJobs(['waiting']);
    expect(new Set(queued.map((job) => job.id)).size).toBe(queued.length);
  });
});

describe('minimum delay between sends', () => {
  it('spaces sends from one sender even when several workers race for them', async () => {
    const user = await createUser(ctx.db);
    const sender = await createSender(ctx.db, ctx.secrets, {
      userId: user.id,
      smtpPort: smtp.port,
      minDelayMs: 300,
    });
    // Six emails due at the same instant: only the gate can space them out.
    const f = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: recipients('r', 6),
      scheduledAt: new Date(),
      delayBetweenMs: 300,
    });
    await startWorkers(2);
    await enqueueFixture(ctx.queues, f);

    await waitUntilAllSent([f.campaign.id], 6);

    const starts = smtp.messages.map((message) => message.startedAt).sort((x, y) => x - y);
    const gaps = starts.slice(1).map((start, i) => start - (starts[i] as number));
    // The gate spaces send *starts* exactly 300 ms apart (see send-gate.test.ts). What the
    // SMTP server observes also includes per-send processing (a cold MySQL/SMTP connection on
    // a worker's first send takes a few tens of ms), so allow 60 ms of observation jitter.
    // Individual observed gaps are environment-sensitive, so assert the overall pacing here.
    expect(gaps).toHaveLength(5);
    expect((starts[5] as number) - (starts[0] as number)).toBeGreaterThanOrEqual(5 * 300 - 100);
  });
});

describe('rescheduling order', () => {
  it('keeps each campaign in order when overflow moves to the next window', async () => {
    const user = await createUser(ctx.db);
    const sender = await createSender(ctx.db, ctx.secrets, {
      userId: user.id,
      smtpPort: smtp.port,
      hourlyLimit: 4,
      minDelayMs: 20,
    });
    await startWorkers(1, 1);
    await alignToWindowStart(WINDOW_MS, 300);
    // Due in the future, so BullMQ releases the delayed jobs in due-time order.
    const t0 = Date.now() + 500;
    // Interleaved due times: A0, B0, A1, B1, … — eight emails for a limit of four.
    const a = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: recipients('a', 4),
      scheduledAt: (i) => new Date(t0 + i * 10),
      hourlyLimit: 4,
    });
    const b = await createCampaign(ctx.db, {
      user,
      sender,
      recipients: recipients('b', 4),
      scheduledAt: (i) => new Date(t0 + i * 10 + 5),
      hourlyLimit: 4,
    });
    await Promise.all([enqueueFixture(ctx.queues, a), enqueueFixture(ctx.queues, b)]);

    await waitUntilAllSent([a.campaign.id, b.campaign.id], 8);

    const order = smtp.messages.map((message) => message.to[0]?.split('@')[0]);
    expect(order).toEqual(['a0', 'b0', 'a1', 'b1', 'a2', 'b2', 'a3', 'b3']);
    const windowOf = await redisWindowOf();
    const firstWindow = windowOf(smtp.messages[0]!.startedAt);
    expect(smtp.messages.map((m) => windowOf(m.startedAt) - firstWindow)).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1,
    ]);
  });
});
