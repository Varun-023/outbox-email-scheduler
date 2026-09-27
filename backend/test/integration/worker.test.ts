import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emails } from '../../src/db/schema';
import { newId } from '../../src/lib/ids';
import { emailJobId } from '../../src/queue/queues';
import { startWorkerRuntime, type WorkerRuntime } from '../../src/workers/run-workers';
import { SendReceiptStore } from '../../src/workers/send-receipts';
import { createTestContext, sleep, waitFor } from '../helpers/context';
import {
  createCampaign,
  createSender,
  createUser,
  emailRow,
  enqueueFixture,
  type CampaignFixture,
} from '../helpers/factories';
import { FakeSmtpServer } from '../helpers/fake-smtp';

const ctx = createTestContext();
const receipts = new SendReceiptStore(ctx.redis, 'test');
let smtp: FakeSmtpServer;
let runtime: WorkerRuntime | undefined;

beforeAll(async () => {
  smtp = await FakeSmtpServer.start();
});
beforeEach(async () => {
  await ctx.reset();
  smtp.reset();
});
afterEach(async () => {
  await runtime?.close();
  runtime = undefined;
});
afterAll(async () => {
  await ctx.close();
  await smtp.close();
});

const startWorker = async () => {
  runtime = await startWorkerRuntime(ctx.env, { logger: ctx.logger, fault: () => {} });
};

async function fixture(recipients: string[], scheduledAt = new Date()): Promise<CampaignFixture> {
  const user = await createUser(ctx.db);
  const sender = await createSender(ctx.db, ctx.secrets, { userId: user.id, smtpPort: smtp.port });
  return createCampaign(ctx.db, { user, sender, recipients, scheduledAt });
}

const finalStatus = (id: string) =>
  waitFor(
    async () => {
      const row = await emailRow(ctx.db, id);
      return row.status === 'sent' || row.status === 'failed' ? row : undefined;
    },
    { message: `email ${id} to finish` },
  );

describe('email worker', () => {
  it('sends a due email once and records the delivery', async () => {
    const f = await fixture(['john@example.com']);
    const email = f.emails[0]!;
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    const row = await finalStatus(email.id);

    expect(row).toMatchObject({
      status: 'sent',
      folder: 'sent',
      attemptCount: 1,
      messageId: `<email-${email.id}@outbox.local>`,
      smtpResponse: expect.stringMatching(/^250/),
      claimToken: null,
      leaseUntil: null,
      errorCode: null,
      version: 3, // created → claimed → sent
    });
    expect(row.completedAt).toEqual(row.sentAt);

    expect(smtp.messages).toHaveLength(1);
    const message = smtp.messages[0]!;
    expect(message.to).toEqual(['john@example.com']);
    expect(message.messageId).toBe(`<email-${email.id}@outbox.local>`);
    expect(message.subject).toBe('Meeting follow-up');
    // Header names are case-insensitive; Nodemailer writes "X-Outbox-Email-ID".
    expect(message.raw).toMatch(new RegExp(`^X-Outbox-Email-Id: ${email.id}`, 'im'));

    expect(await receipts.get(email.id)).toMatchObject({ messageId: row.messageId });
    const job = await ctx.queues.emails.getJob(emailJobId(email.id));
    expect(job?.returnvalue).toEqual({ outcome: 'sent', messageId: row.messageId });
  });

  it('does not send before the scheduled time', async () => {
    const scheduledAt = new Date(Date.now() + 1_500);
    const f = await fixture(['john@example.com'], scheduledAt);
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    await sleep(800);
    expect(smtp.messages).toHaveLength(0);
    await finalStatus(f.emails[0]!.id);
    expect(smtp.messages[0]!.startedAt).toBeGreaterThanOrEqual(scheduledAt.getTime());
  });

  it('retries a transient SMTP failure with backoff and then delivers', async () => {
    const f = await fixture(['john@example.com']);
    smtp.onRecipient('john@example.com', (attempt) =>
      attempt === 1 ? { code: 451, message: 'Greylisted, try again' } : null,
    );
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    const row = await finalStatus(f.emails[0]!.id);

    expect(row).toMatchObject({ status: 'sent', attemptCount: 2 });
    expect(smtp.attemptsFor('john@example.com')).toBe(2);
    expect(smtp.messages).toHaveLength(1);
  });

  it('fails a permanent SMTP rejection without retrying', async () => {
    const f = await fixture(['gone@example.com']);
    smtp.onRecipient('gone@example.com', () => ({ code: 550, message: 'Mailbox unavailable' }));
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    const row = await finalStatus(f.emails[0]!.id);

    expect(row).toMatchObject({
      status: 'failed',
      folder: 'sent',
      errorCode: 'SMTP_PERMANENT',
      attemptCount: 1,
    });
    expect(row.errorMessage).toMatch(/Mailbox unavailable/);
    expect(smtp.attemptsFor('gone@example.com')).toBe(1);
    expect(await (await ctx.queues.emails.getJob(emailJobId(row.id)))?.getState()).toBe('failed');
  });

  it('marks the email failed once every retry is exhausted', async () => {
    const f = await fixture(['busy@example.com']);
    smtp.onRecipient('busy@example.com', () => ({ code: 421, message: 'Service busy' }));
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    const row = await finalStatus(f.emails[0]!.id);

    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'RETRIES_EXHAUSTED',
      attemptCount: 3,
    });
    expect(smtp.attemptsFor('busy@example.com')).toBe(3); // EMAIL_JOB_ATTEMPTS=3 in tests
    expect(smtp.messages).toHaveLength(0);
  });

  it('ignores duplicate enqueues and re-runs of an email that was already sent', async () => {
    const f = await fixture(['john@example.com'], new Date(Date.now() + 500));
    await enqueueFixture(ctx.queues, f);
    await enqueueFixture(ctx.queues, f); // e.g. an API retry or the reconciler
    expect(await ctx.queues.emails.getJobCountByTypes('delayed', 'waiting')).toBe(1);

    await startWorker();
    await finalStatus(f.emails[0]!.id);
    await enqueueFixture(ctx.queues, f); // the completed job still exists: ignored
    const job = await ctx.queues.emails.getJob(emailJobId(f.emails[0]!.id));
    await job?.remove();
    await enqueueFixture(ctx.queues, f); // a brand-new job for the same email
    await waitFor(
      async () =>
        (await ctx.queues.emails.getJobCounts('completed')).completed === 1 &&
        (await ctx.queues.emails.getJob(emailJobId(f.emails[0]!.id)))?.returnvalue,
      {
        message: 'the re-added job to finish',
      },
    );

    expect((await ctx.queues.emails.getJob(emailJobId(f.emails[0]!.id)))?.returnvalue).toEqual({
      outcome: 'skipped',
      reason: 'already-final',
    });
    expect(smtp.messages).toHaveLength(1);
  });
});

describe('recovering an interrupted send', () => {
  async function claimedEmail(leaseUntil: Date) {
    const f = await fixture(['john@example.com']);
    const email = f.emails[0]!;
    const token = newId();
    await ctx.db
      .update(emails)
      .set({ status: 'sending', claimToken: token, leaseUntil, attemptCount: 1 })
      .where(eq(emails.id, email.id));
    return { f, email, token };
  }

  it('finalises from the Redis receipt without sending again', async () => {
    const { f, email, token } = await claimedEmail(new Date(Date.now() + 60_000));
    await receipts.save(email.id, {
      messageId: '<already@sent>',
      response: '250 OK',
      previewUrl: 'https://ethereal.email/message/abc',
      sentAt: new Date(),
      claimToken: token,
    });
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    const row = await finalStatus(email.id);

    expect(row).toMatchObject({
      status: 'sent',
      messageId: '<already@sent>',
      previewUrl: 'https://ethereal.email/message/abc',
    });
    expect(smtp.messages).toHaveLength(0);
  });

  it('waits for a live lease, then marks DELIVERY_UNCERTAIN and never resends', async () => {
    const { f, email } = await claimedEmail(new Date(Date.now() + 1_500));
    await startWorker();
    await enqueueFixture(ctx.queues, f);

    await sleep(700);
    expect((await emailRow(ctx.db, email.id)).status).toBe('sending'); // lease still held
    const row = await finalStatus(email.id);

    expect(row).toMatchObject({ status: 'failed', errorCode: 'DELIVERY_UNCERTAIN' });
    expect(smtp.messages).toHaveLength(0);
  });
});
