import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { tryAcquireLock } from '../lib/redis-lock';
import type { CampaignsRepository } from '../modules/campaigns/campaigns.repository';
import type { EmailsRepository } from '../modules/emails/emails.repository';
import { emailJobId, enqueueEmailJobs, type SendEmailJobData } from '../queue/queues';
import type { SendReceiptStore } from './send-receipts';

const LOCK_TTL_MS = 60_000;
const NOT_ENQUEUED_GRACE_MS = 30_000;
const BATCH_SIZE = 500;

export interface ReconcileDeps {
  emails: EmailsRepository;
  campaigns: CampaignsRepository;
  emailQueue: Queue<SendEmailJobData>;
  receipts: SendReceiptStore;
  redis: Redis;
  keyPrefix: string;
  uncertainPolicy: 'fail' | 'resend';
  /** How late a scheduled email must be before its job is checked (default 2 minutes). */
  overdueGraceMs?: number;
  /** How old an un-enqueued campaign must be before it is enqueued (default 30 seconds). */
  notEnqueuedGraceMs?: number;
  logger: Logger;
}

export interface ReconcileReport {
  skipped?: 'locked';
  campaignsEnqueued: number;
  missingJobsAdded: number;
  failedJobsRetried: number;
  scheduledSwept: number;
  leasesResolved: number;
}

/**
 * Recovery only — scheduling itself is exclusively BullMQ delayed jobs. MySQL is the source
 * of truth; this repairs the gaps a crash or a Redis outage can leave:
 *   1. campaigns committed to MySQL whose jobs never reached Redis (enqueued_at IS NULL);
 *   2. overdue scheduled emails whose job is missing or ended up in the failed set;
 *   3. (startup) every scheduled email re-added idempotently, rebuilding lost Redis data;
 *   4. claims whose lease expired without a receipt (the uncertain crash window).
 * Every re-add uses the email's fixed job id, so it can never create a duplicate job.
 */
export async function reconcile(
  deps: ReconcileDeps,
  options: { fullSweep: boolean },
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    campaignsEnqueued: 0,
    missingJobsAdded: 0,
    failedJobsRetried: 0,
    scheduledSwept: 0,
    leasesResolved: 0,
  };
  const lock = await tryAcquireLock(deps.redis, `${deps.keyPrefix}:lock:reconcile`, LOCK_TTL_MS);
  if (!lock) return { ...report, skipped: 'locked' };

  try {
    await enqueueStuckCampaigns(deps, report);
    await repairOverdueJobs(deps, report);
    if (options.fullSweep) await sweepScheduled(deps, report);
    await resolveExpiredLeases(deps, report);
  } finally {
    await lock.release();
  }

  if (
    report.campaignsEnqueued ||
    report.missingJobsAdded ||
    report.failedJobsRetried ||
    report.leasesResolved
  ) {
    deps.logger.info({ report }, 'Reconciler repaired queue state');
  }
  return report;
}

async function enqueueStuckCampaigns(deps: ReconcileDeps, report: ReconcileReport) {
  const stuck = await deps.campaigns.listNotEnqueued(
    new Date(Date.now() - (deps.notEnqueuedGraceMs ?? NOT_ENQUEUED_GRACE_MS)),
    100,
  );
  for (const { id } of stuck) {
    await enqueueEmailJobs(deps.emailQueue, await deps.campaigns.scheduledJobsFor(id));
    await deps.campaigns.markEnqueued(id, new Date());
    report.campaignsEnqueued += 1;
  }
}

async function repairOverdueJobs(deps: ReconcileDeps, report: ReconcileReport) {
  const before = new Date(Date.now() - (deps.overdueGraceMs ?? 120_000));
  let after: { time: Date; id: string } | undefined;

  for (;;) {
    const rows = await deps.emails.listScheduled({ before, after, limit: BATCH_SIZE });
    for (const row of rows) {
      const job = await deps.emailQueue.getJob(emailJobId(row.emailId));
      if (!job) {
        await enqueueEmailJobs(deps.emailQueue, [row]);
        report.missingJobsAdded += 1;
        continue;
      }
      const state = await job.getState();
      if (state === 'failed') {
        await job.retry('failed');
        report.failedJobsRetried += 1;
      } else if (state === 'completed') {
        // Finished as a no-op while the row stayed scheduled: replace it with a fresh job.
        await job.remove();
        await enqueueEmailJobs(deps.emailQueue, [row]);
        report.missingJobsAdded += 1;
      }
    }
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH_SIZE) return;
    after = { time: last.scheduledAt, id: last.emailId };
  }
}

async function sweepScheduled(deps: ReconcileDeps, report: ReconcileReport) {
  let after: { time: Date; id: string } | undefined;
  for (;;) {
    const rows = await deps.emails.listScheduled({ after, limit: BATCH_SIZE });
    await enqueueEmailJobs(deps.emailQueue, rows);
    report.scheduledSwept += rows.length;
    const last = rows[rows.length - 1];
    if (!last || rows.length < BATCH_SIZE) return;
    after = { time: last.scheduledAt, id: last.emailId };
  }
}

async function resolveExpiredLeases(deps: ReconcileDeps, report: ReconcileReport) {
  const now = new Date();
  const expired = await deps.emails.listExpiredLeases(now, 200);
  for (const { id } of expired) {
    const receipt = await deps.receipts.get(id);
    if (receipt) {
      if (await deps.emails.markSentFromReceipt(id, receipt)) report.leasesResolved += 1;
      continue;
    }

    const job = await deps.emailQueue.getJob(emailJobId(id));
    const state = job ? await job.getState() : undefined;
    // An active job is still owned by a worker, or BullMQ's stall detection will re-run it.
    if (state === 'active') continue;

    if (deps.uncertainPolicy === 'fail') {
      if (await deps.emails.markUncertainIfLeaseExpired(id, now)) report.leasesResolved += 1;
      continue;
    }
    if (await deps.emails.releaseExpiredClaim(id, now)) {
      report.leasesResolved += 1;
      if (job && state === 'failed') await job.retry('failed');
    }
  }
}
