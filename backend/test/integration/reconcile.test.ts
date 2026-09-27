import { UnrecoverableError, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { campaigns, emails } from '../../src/db/schema';
import { newId } from '../../src/lib/ids';
import { tryAcquireLock } from '../../src/lib/redis-lock';
import { CampaignsRepository } from '../../src/modules/campaigns/campaigns.repository';
import { EmailsRepository } from '../../src/modules/emails/emails.repository';
import { emailJobId, QUEUE_NAMES } from '../../src/queue/queues';
import { reconcile, type ReconcileDeps } from '../../src/workers/reconcile';
import { SendReceiptStore } from '../../src/workers/send-receipts';
import { createTestContext, waitFor } from '../helpers/context';
import {
  createCampaign,
  createSender,
  createUser,
  emailRow,
  enqueueFixture,
} from '../helpers/factories';

const ctx = createTestContext();
const receipts = new SendReceiptStore(ctx.redis, 'test');
const deps: ReconcileDeps = {
  emails: new EmailsRepository(ctx.db),
  campaigns: new CampaignsRepository(ctx.db),
  emailQueue: ctx.queues.emails,
  receipts,
  redis: ctx.redis,
  keyPrefix: 'test',
  uncertainPolicy: 'fail',
  overdueGraceMs: 0,
  notEnqueuedGraceMs: 0,
  logger: ctx.logger,
};

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

async function fixture(scheduledAt: Date, count = 2) {
  const user = await createUser(ctx.db);
  const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: 2525 });
  return createCampaign(ctx.db, {
    user,
    sender,
    recipients: Array.from({ length: count }, (_, i) => `r${i}@example.com`),
    scheduledAt,
  });
}

const jobState = async (emailId: string) =>
  (await ctx.queues.emails.getJob(emailJobId(emailId)))?.getState();

describe('reconciler (recovery only)', () => {
  it('enqueues campaigns committed to MySQL whose jobs never reached Redis', async () => {
    const f = await fixture(new Date(Date.now() + 60_000));
    await ctx.db.update(campaigns).set({ enqueuedAt: null }).where(eq(campaigns.id, f.campaign.id));

    const report = await reconcile(deps, { fullSweep: false });

    expect(report.campaignsEnqueued).toBe(1);
    for (const email of f.emails) expect(await jobState(email.id)).toBe('delayed');
    const [row] = await ctx.db.select().from(campaigns);
    expect(row?.enqueuedAt).toBeInstanceOf(Date);
  });

  it('rebuilds every scheduled job on startup after Redis data is lost', async () => {
    const f = await fixture(new Date(Date.now() + 60_000), 3);
    await enqueueFixture(ctx.queues, f);
    await ctx.redis.flushdb(); // simulate losing Redis data

    const report = await reconcile(deps, { fullSweep: true });

    expect(report.scheduledSwept).toBe(3);
    for (const email of f.emails) {
      const job = await ctx.queues.emails.getJob(emailJobId(email.id));
      expect(await job?.getState()).toBe('delayed');
      expect((job?.timestamp ?? 0) + (job?.opts.delay ?? 0)).toBeCloseTo(
        email.scheduledAt.getTime(),
        -3,
      );
    }
    // A second sweep is a no-op: job ids are deterministic.
    await reconcile(deps, { fullSweep: true });
    expect(await ctx.queues.emails.getJobCountByTypes('delayed')).toBe(3);
  });

  it('adds missing jobs and retries failed jobs for overdue scheduled emails', async () => {
    const f = await fixture(new Date(Date.now() - 5_000));
    await enqueueEmailFor(f.emails[0]!.id, f);
    const failer = new Worker(
      QUEUE_NAMES.emails,
      async () => {
        throw new UnrecoverableError('simulated');
      },
      { connection: ctx.redis.duplicate({ maxRetriesPerRequest: null }), prefix: 'test' },
    );
    await waitFor(async () => (await jobState(f.emails[0]!.id)) === 'failed', {
      message: 'job to fail',
    });
    await failer.close();

    const report = await reconcile(deps, { fullSweep: false });

    expect(report).toMatchObject({ failedJobsRetried: 1, missingJobsAdded: 1 });
    expect(await jobState(f.emails[0]!.id)).toBe('waiting');
    expect(await jobState(f.emails[1]!.id)).toBe('waiting');
  });

  it('resolves an expired claim from its receipt', async () => {
    const f = await fixture(new Date());
    const email = f.emails[0]!;
    await expireClaim(email.id);
    await receipts.save(email.id, {
      messageId: '<m@x>',
      response: '250 OK',
      previewUrl: null,
      sentAt: new Date(),
      claimToken: 't',
    });

    const report = await reconcile(deps, { fullSweep: false });

    expect(report.leasesResolved).toBe(1);
    expect(await emailRow(ctx.db, email.id)).toMatchObject({ status: 'sent', messageId: '<m@x>' });
  });

  it('marks an expired claim without a receipt DELIVERY_UNCERTAIN (never resent)', async () => {
    const f = await fixture(new Date());
    await expireClaim(f.emails[0]!.id);

    await reconcile(deps, { fullSweep: false });

    expect(await emailRow(ctx.db, f.emails[0]!.id)).toMatchObject({
      status: 'failed',
      errorCode: 'DELIVERY_UNCERTAIN',
    });
  });

  it('returns the claim to the queue under UNCERTAIN_DELIVERY_POLICY=resend', async () => {
    const f = await fixture(new Date());
    await expireClaim(f.emails[0]!.id);

    await reconcile({ ...deps, uncertainPolicy: 'resend' }, { fullSweep: false });

    expect(await emailRow(ctx.db, f.emails[0]!.id)).toMatchObject({
      status: 'scheduled',
      claimToken: null,
    });
  });

  it('runs one reconciliation at a time across workers', async () => {
    const lock = await tryAcquireLock(ctx.redis, 'test:lock:reconcile', 5_000);

    const report = await reconcile(deps, { fullSweep: true });

    expect(report.skipped).toBe('locked');
    await lock?.release();
  });
});

async function expireClaim(emailId: string) {
  await ctx.db
    .update(emails)
    .set({ status: 'sending', claimToken: newId(), leaseUntil: new Date(Date.now() - 1_000) })
    .where(eq(emails.id, emailId));
}

async function enqueueEmailFor(emailId: string, f: Awaited<ReturnType<typeof fixture>>) {
  await enqueueFixture(ctx.queues, { ...f, emails: f.emails.filter((e) => e.id === emailId) });
}
