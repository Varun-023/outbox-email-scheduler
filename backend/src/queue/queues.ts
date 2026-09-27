import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAMES = {
  emails: 'emails',
  notifications: 'notifications',
  searchSync: 'search-sync',
  maintenance: 'maintenance',
} as const;

export const JOB_NAMES = {
  sendEmail: 'send-email',
  rateLimitReached: 'slack-rate-limit',
  indexEmails: 'index-emails',
  reconcile: 'reconcile',
} as const;

export const RECONCILE_SCHEDULER_ID = 'reconcile';

export interface SendEmailJobData {
  emailId: string;
  campaignId: string;
  senderId: string;
  userId: string;
  to: string;
  /** A slot the send gate already reserved (and counted) for this job. */
  reservation?: { slotAt: number; windowIdx: number };
  /** Database outages retried so far; they never consume a job attempt. */
  infraRetries?: number;
}

export interface RateLimitNotificationJobData {
  userId: string;
  senderId: string;
  campaignId: string;
  scope: 'sender' | 'campaign';
  windowIdx: number;
  limit: number;
  /** Start of the next window, when sending resumes (ISO 8601). */
  resumesAt: string;
}

// Custom BullMQ job ids must not contain ":" and must not be numeric.
export const emailJobId = (emailId: string) => `email-${emailId}`;
export const rateLimitNotificationJobId = (scope: string, scopeId: string, windowIdx: number) =>
  `rl-${scope}-${scopeId}-${windowIdx}`;

const DAY_SECONDS = 24 * 60 * 60;

export interface QueueSettings {
  prefix: string;
  emailJobAttempts: number;
  emailJobBackoffMs: number;
}

export interface Queues {
  emails: Queue<SendEmailJobData>;
  notifications: Queue<RateLimitNotificationJobData>;
  searchSync: Queue;
  maintenance: Queue;
}

export function createQueues(connection: Redis, settings: QueueSettings): Queues {
  const common = { connection, prefix: settings.prefix };
  return {
    emails: new Queue<SendEmailJobData>(QUEUE_NAMES.emails, {
      ...common,
      defaultJobOptions: {
        attempts: settings.emailJobAttempts,
        backoff: { type: 'exponential', delay: settings.emailJobBackoffMs },
        removeOnComplete: { age: 7 * DAY_SECONDS, count: 10_000 },
        removeOnFail: { age: 30 * DAY_SECONDS },
      },
    }),
    notifications: new Queue<RateLimitNotificationJobData>(QUEUE_NAMES.notifications, {
      ...common,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { age: DAY_SECONDS },
        removeOnFail: { age: 7 * DAY_SECONDS },
      },
    }),
    searchSync: new Queue(QUEUE_NAMES.searchSync, {
      ...common,
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 5_000 },
        // Removed on completion so a later change can enqueue the same job id again.
        removeOnComplete: true,
        removeOnFail: { age: 7 * DAY_SECONDS },
      },
    }),
    maintenance: new Queue(QUEUE_NAMES.maintenance, {
      ...common,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 50 },
      },
    }),
  };
}

export async function closeQueues(queues: Queues): Promise<void> {
  await Promise.allSettled(Object.values(queues).map((queue: Queue) => queue.close()));
}

export interface EmailJobSpec {
  emailId: string;
  campaignId: string;
  senderId: string;
  userId: string;
  to: string;
  scheduledAt: Date;
}

const ENQUEUE_CHUNK_SIZE = 500;

/**
 * Adds one delayed job per email. The job id is derived from the email id, so adding the
 * same email twice (API retry, reconciler) is ignored by BullMQ while the job exists.
 */
export async function enqueueEmailJobs(
  queue: Queue<SendEmailJobData>,
  jobs: readonly EmailJobSpec[],
  now = Date.now(),
): Promise<void> {
  for (let start = 0; start < jobs.length; start += ENQUEUE_CHUNK_SIZE) {
    const chunk = jobs.slice(start, start + ENQUEUE_CHUNK_SIZE);
    await queue.addBulk(
      chunk.map((job) => ({
        name: JOB_NAMES.sendEmail,
        data: {
          emailId: job.emailId,
          campaignId: job.campaignId,
          senderId: job.senderId,
          userId: job.userId,
          to: job.to,
        },
        opts: {
          jobId: emailJobId(job.emailId),
          delay: Math.max(0, job.scheduledAt.getTime() - now),
        },
      })),
    );
  }
}
