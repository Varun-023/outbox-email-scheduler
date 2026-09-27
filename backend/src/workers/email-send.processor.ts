import { DelayedError, UnrecoverableError, type Job, type Queue } from 'bullmq';
import type { Logger } from 'pino';
import { isDatabaseUnavailableError } from '../db/errors';
import { newId } from '../lib/ids';
import type { FaultInjector } from '../lib/test-faults';
import { buildMessage } from '../mail/build-message';
import { classifySmtpError } from '../mail/classify-smtp-error';
import type { TransportPool } from '../mail/transport-pool';
import type { EmailsRepository, SendableEmail } from '../modules/emails/emails.repository';
import { effectiveSenderLimits, type SenderDefaults } from '../modules/senders/senders.service';
import {
  JOB_NAMES,
  rateLimitNotificationJobId,
  type RateLimitNotificationJobData,
  type SendEmailJobData,
} from '../queue/queues';
import { windowIndex } from '../rate-limit/keys';
import type { GateDecision, SendGate } from '../rate-limit/send-gate';
import type { SendReceiptStore } from './send-receipts';

/** A job promoted slightly early (clock skew, Bull Board "promote") waits for its time. */
const DUE_TOLERANCE_MS = 1_000;
/** Waits up to this long happen inline; longer ones go back to BullMQ as a delayed job. */
const INLINE_WAIT_MS = 50;
/** A reservation is honoured only if the job wakes within this grace period. */
const RESERVATION_GRACE_MS = 5_000;
const MAX_INFRA_BACKOFF_MS = 60_000;

export interface EmailSendConfig {
  windowMs: number;
  senderDefaults: SenderDefaults;
  leaseMs: number;
  messageIdDomain: string;
  uncertainPolicy: 'fail' | 'resend';
}

export interface EmailSendDeps {
  emails: EmailsRepository;
  gate: SendGate;
  receipts: SendReceiptStore;
  transports: Pick<TransportPool, 'send'>;
  notifications: Queue<RateLimitNotificationJobData>;
  config: EmailSendConfig;
  logger: Logger;
  fault: FaultInjector;
}

export type SendOutcome =
  | { outcome: 'sent'; messageId: string }
  | { outcome: 'recovered-from-receipt'; messageId: string }
  | { outcome: 'skipped'; reason: 'missing' | 'already-final' | 'claim-lost' };

type EmailJob = Job<SendEmailJobData, SendOutcome>;
type Reservation = NonNullable<SendEmailJobData['reservation']>;

/** Re-queue this job for later without consuming an attempt (BullMQ's manual-delay pattern). */
async function delayUntil(job: EmailJob, token: string | undefined, at: number): Promise<never> {
  await job.moveToDelayed(Math.round(at), token);
  throw new DelayedError();
}

function isFinalAttempt(job: EmailJob): boolean {
  return job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
}

/**
 * Sends one email with at-most-once semantics for the uncertain crash window:
 *
 *   load row → recover in-flight claim → wait until due → send gate (rate limits)
 *   → claim (scheduled→sending + lease) → SMTP → Redis receipt → mark sent.
 */
export function createEmailSendProcessor(deps: EmailSendDeps) {
  const { emails, gate, receipts, transports, config, fault } = deps;

  /** A slot reserved on an earlier run is honoured if the job woke up in time for it. */
  function usableReservation(job: EmailJob, now: number): Reservation | undefined {
    const reservation = job.data.reservation;
    if (
      reservation !== undefined &&
      now <= reservation.slotAt + RESERVATION_GRACE_MS &&
      windowIndex(now, config.windowMs) === reservation.windowIdx
    ) {
      return reservation;
    }
    return undefined;
  }

  async function announceLimitReached(row: SendableEmail, decision: GateDecision) {
    if (decision.kind !== 'allow') return;
    const limits = effectiveSenderLimits(row.sender, config.senderDefaults);
    const scopes = [
      decision.senderReached && {
        scope: 'sender' as const,
        id: row.sender.id,
        limit: limits.hourlyLimit,
      },
      decision.campaignReached && {
        scope: 'campaign' as const,
        id: row.campaign.id,
        limit: row.campaign.hourlyLimit,
      },
    ].filter((entry) => entry !== false);

    for (const entry of scopes) {
      try {
        await deps.notifications.add(
          JOB_NAMES.rateLimitReached,
          {
            userId: row.email.userId,
            senderId: row.sender.id,
            campaignId: row.campaign.id,
            scope: entry.scope,
            windowIdx: decision.windowIdx,
            limit: entry.limit,
            resumesAt: new Date((decision.windowIdx + 1) * config.windowMs).toISOString(),
          },
          { jobId: rateLimitNotificationJobId(entry.scope, entry.id, decision.windowIdx) },
        );
      } catch (err) {
        // Notifications are best effort: they must never block or fail a send.
        deps.logger.warn(
          { err, scope: entry.scope },
          'Could not enqueue the rate-limit notification',
        );
      }
    }
  }

  /** A previous run claimed this email and never finished. Returns an outcome, or null to resend. */
  async function recoverInFlight(
    job: EmailJob,
    token: string | undefined,
    row: SendableEmail,
  ): Promise<SendOutcome | null> {
    const receipt = await receipts.get(row.email.id);
    if (receipt) {
      await emails.markSentFromReceipt(row.email.id, receipt);
      deps.logger.info({ emailId: row.email.id }, 'Recovered a sent email from its receipt');
      return { outcome: 'recovered-from-receipt', messageId: receipt.messageId };
    }

    const leaseUntil = row.email.leaseUntil?.getTime() ?? 0;
    if (leaseUntil > Date.now()) {
      // Another worker may still be sending (e.g. this job was re-run after a stall).
      return delayUntil(job, token, leaseUntil + 1_000);
    }

    if (config.uncertainPolicy === 'fail') {
      await emails.markUncertainIfLeaseExpired(row.email.id);
      throw new UnrecoverableError('Delivery uncertain: the worker stopped mid-send');
    }
    await emails.releaseExpiredClaim(row.email.id);
    return null;
  }

  async function handleSmtpFailure(
    job: EmailJob,
    row: SendableEmail,
    claimToken: string,
    err: unknown,
  ): Promise<never> {
    const emailId = row.email.id;
    const message = err instanceof Error ? err.message : String(err);
    const kind = classifySmtpError(err);

    if (kind === 'permanent') {
      await emails.markFailed(emailId, claimToken, 'SMTP_PERMANENT', message);
      throw new UnrecoverableError(message);
    }
    if (kind === 'uncertain' && config.uncertainPolicy === 'fail') {
      await emails.markFailed(emailId, claimToken, 'DELIVERY_UNCERTAIN', message);
      throw new UnrecoverableError(`Delivery uncertain: ${message}`);
    }
    if (isFinalAttempt(job)) {
      await emails.markFailed(emailId, claimToken, 'RETRIES_EXHAUSTED', message);
      throw err;
    }
    await emails.releaseClaim(emailId, claimToken, 'SMTP_TRANSIENT', message);
    throw err;
  }

  async function processJob(job: EmailJob, token: string | undefined): Promise<SendOutcome> {
    const emailId = job.data.emailId;
    let row = await emails.findForSending(emailId);
    if (!row) return { outcome: 'skipped', reason: 'missing' };

    const status = row.email.status;
    if (status === 'sent' || status === 'failed') {
      return { outcome: 'skipped', reason: 'already-final' };
    }
    if (status === 'sending') {
      const recovered = await recoverInFlight(job, token, row);
      if (recovered) return recovered;
      row = await emails.findForSending(emailId);
      if (!row || row.email.status !== 'scheduled') {
        return { outcome: 'skipped', reason: 'claim-lost' };
      }
    }

    const now = Date.now();
    if (row.email.scheduledAt.getTime() > now + DUE_TOLERANCE_MS) {
      return delayUntil(job, token, row.email.scheduledAt.getTime());
    }

    const limits = effectiveSenderLimits(row.sender, config.senderDefaults);
    let reservation = usableReservation(job, now);
    if (reservation === undefined) {
      const decision = await gate.reserve({
        senderId: row.sender.id,
        campaignId: row.campaign.id,
        sender: { limit: limits.hourlyLimit, gapMs: limits.minDelayMs },
        campaign: { limit: row.campaign.hourlyLimit, gapMs: row.campaign.delayBetweenMs },
      });
      await announceLimitReached(row, decision);

      if (decision.kind === 'defer') {
        // Hourly window full: never fail — move to the ticketed slot in a later window.
        const until = Date.now() + decision.delayMs;
        await emails.defer(
          emailId,
          new Date(until),
          decision.scope === 'sender' ? 'sender_hourly_limit' : 'campaign_hourly_limit',
        );
        await job.updateData({ ...job.data, reservation: undefined });
        return delayUntil(job, token, until);
      }
      reservation = { slotAt: Date.now() + decision.waitMs, windowIdx: decision.windowIdx };
      if (decision.waitMs > INLINE_WAIT_MS) {
        // The slot is reserved (and counted); wake up then without asking the gate again.
        await job.updateData({ ...job.data, reservation });
        return delayUntil(job, token, reservation.slotAt);
      }
    }

    // Never start before the reserved slot, and never closer than the gap to the previous
    // actual send (a late wake-up of an earlier job must not squeeze this one).
    for (;;) {
      const waitMs = Math.max(
        reservation.slotAt - Date.now(),
        await gate.confirmStart({
          senderId: row.sender.id,
          campaignId: row.campaign.id,
          senderGapMs: limits.minDelayMs,
          campaignGapMs: row.campaign.delayBetweenMs,
        }),
      );
      if (waitMs <= 0) break;
      if (waitMs > INLINE_WAIT_MS) {
        // Keep the counted hourly slot (same window) and come back when the gap has passed.
        reservation = { ...reservation, slotAt: Date.now() + waitMs };
        await job.updateData({ ...job.data, reservation });
        return delayUntil(job, token, reservation.slotAt);
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const claimToken = newId();
    const claimed = await emails.claim(emailId, claimToken, new Date(Date.now() + config.leaseMs));
    if (!claimed) return { outcome: 'skipped', reason: 'claim-lost' };
    fault('after_claim');

    const message = buildMessage(
      {
        emailId,
        campaignId: row.campaign.id,
        fromName: row.sender.fromName,
        fromEmail: row.sender.fromEmail,
        recipientEmail: row.email.recipientEmail,
        recipientName: row.email.recipientName,
        subject: row.campaign.subject,
        bodyHtml: row.campaign.bodyHtml,
        bodyText: row.campaign.bodyText,
      },
      config.messageIdDomain,
    );

    let sent;
    try {
      sent = await transports.send(row.sender, message);
    } catch (err) {
      return handleSmtpFailure(job, row, claimToken, err);
    }
    fault('after_smtp_before_receipt');

    const receipt = { ...sent, sentAt: new Date(), claimToken };
    await receipts.save(emailId, receipt);
    fault('after_receipt');

    const marked = await emails.markSent(emailId, claimToken, receipt);
    fault('after_sent_update');
    if (!marked) {
      deps.logger.warn({ emailId }, 'Sent, but the row was no longer claimed by this worker');
    }
    return { outcome: 'sent', messageId: sent.messageId };
  }

  return async function processEmailJob(job: EmailJob, token?: string): Promise<SendOutcome> {
    try {
      return await processJob(job, token);
    } catch (err) {
      if (err instanceof DelayedError || err instanceof UnrecoverableError) throw err;
      if (isDatabaseUnavailableError(err)) {
        // MySQL outages must not burn attempts; back off and try again later.
        const retries = (job.data.infraRetries ?? 0) + 1;
        const delayMs = Math.min(1_000 * 2 ** Math.min(retries, 6), MAX_INFRA_BACKOFF_MS);
        deps.logger.warn(
          { err, emailId: job.data.emailId, retries, delayMs },
          'Database unavailable; retrying without using an attempt',
        );
        await job.updateData({ ...job.data, infraRetries: retries });
        await delayUntil(job, token, Date.now() + delayMs);
      }
      throw err;
    }
  };
}
