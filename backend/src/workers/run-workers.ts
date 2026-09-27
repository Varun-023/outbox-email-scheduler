import { Worker } from 'bullmq';
import type { Logger } from 'pino';
import type { Env } from '../config/env';
import { createDatabase, createDatabasePool } from '../db/client';
import { SecretBox } from '../lib/crypto';
import { createFaultInjector, type FaultInjector } from '../lib/test-faults';
import { TransportPool } from '../mail/transport-pool';
import { CampaignsRepository } from '../modules/campaigns/campaigns.repository';
import { EmailsRepository } from '../modules/emails/emails.repository';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  RECONCILE_SCHEDULER_ID,
  closeQueues,
  createQueues,
  type SendEmailJobData,
} from '../queue/queues';
import { closeRedisConnection, createRedisConnection } from '../queue/redis';
import { SendGate } from '../rate-limit/send-gate';
import { createEmailSendProcessor, type SendOutcome } from './email-send.processor';
import { reconcile, type ReconcileDeps, type ReconcileReport } from './reconcile';
import { SendReceiptStore } from './send-receipts';

export interface WorkerRuntime {
  emailWorker: Worker<SendEmailJobData, SendOutcome>;
  reconcile(options: { fullSweep: boolean }): Promise<ReconcileReport>;
  close(): Promise<void>;
}

export interface WorkerRuntimeOptions {
  logger: Logger;
  fault?: FaultInjector;
  /** Tests shorten the overdue grace so recovery paths run quickly. */
  overdueGraceMs?: number;
}

export async function startWorkerRuntime(
  env: Env,
  options: WorkerRuntimeOptions,
): Promise<WorkerRuntime> {
  const { logger } = options;
  const pool = createDatabasePool({
    url: env.DATABASE_URL,
    connectionLimit: env.EMAIL_WORKER_CONCURRENCY + 5,
  });
  const db = createDatabase(pool);
  const redis = createRedisConnection(env.REDIS_URL, logger.child({ component: 'redis' }), {
    connectionName: 'outbox-worker',
  });
  // BullMQ workers need maxRetriesPerRequest=null on their connection.
  const bullConnection = createRedisConnection(
    env.REDIS_URL,
    logger.child({ component: 'redis-bullmq' }),
    { connectionName: 'outbox-worker-bullmq', maxRetriesPerRequest: null },
  );
  const queues = createQueues(redis, {
    prefix: env.BULLMQ_PREFIX,
    emailJobAttempts: env.EMAIL_JOB_ATTEMPTS,
    emailJobBackoffMs: env.EMAIL_JOB_BACKOFF_MS,
  });

  const emails = new EmailsRepository(db);
  const receipts = new SendReceiptStore(redis, env.BULLMQ_PREFIX);
  const transports = new TransportPool(new SecretBox(env.ENCRYPTION_KEY), {
    connectionTimeoutMs: env.SMTP_CONNECTION_TIMEOUT_MS,
    socketTimeoutMs: env.SMTP_SOCKET_TIMEOUT_MS,
    requireTls: env.SMTP_REQUIRE_TLS,
  });

  const processor = createEmailSendProcessor({
    emails,
    gate: new SendGate(redis, env.BULLMQ_PREFIX, env.RATE_LIMIT_WINDOW_MS),
    receipts,
    transports,
    notifications: queues.notifications,
    config: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      senderDefaults: {
        hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      },
      leaseMs: env.SEND_LEASE_MS,
      messageIdDomain: env.MESSAGE_ID_DOMAIN,
      uncertainPolicy: env.UNCERTAIN_DELIVERY_POLICY,
    },
    logger: logger.child({ component: 'email-send' }),
    fault: options.fault ?? createFaultInjector(env),
  });

  const reconcileDeps: ReconcileDeps = {
    emails,
    campaigns: new CampaignsRepository(db),
    emailQueue: queues.emails,
    receipts,
    redis,
    keyPrefix: env.BULLMQ_PREFIX,
    uncertainPolicy: env.UNCERTAIN_DELIVERY_POLICY,
    overdueGraceMs: options.overdueGraceMs,
    logger: logger.child({ component: 'reconciler' }),
  };

  const emailWorker = new Worker<SendEmailJobData, SendOutcome>(QUEUE_NAMES.emails, processor, {
    connection: bullConnection,
    prefix: env.BULLMQ_PREFIX,
    concurrency: env.EMAIL_WORKER_CONCURRENCY,
    lockDuration: env.EMAIL_WORKER_LOCK_DURATION_MS,
    stalledInterval: env.EMAIL_WORKER_STALLED_INTERVAL_MS,
    maxStalledCount: 2,
  });
  emailWorker.on('failed', (job, err) => {
    logger.warn({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'Email job failed');
  });
  emailWorker.on('error', (err) => logger.error({ err }, 'Email worker error'));

  const maintenanceWorker = new Worker(
    QUEUE_NAMES.maintenance,
    async () => reconcile(reconcileDeps, { fullSweep: false }),
    { connection: bullConnection, prefix: env.BULLMQ_PREFIX, concurrency: 1 },
  );
  maintenanceWorker.on('error', (err) => logger.error({ err }, 'Maintenance worker error'));

  // The periodic run is a safety net for Redis/DB drift, never the scheduler itself.
  if (env.RECONCILE_INTERVAL_MS > 0) {
    await queues.maintenance.upsertJobScheduler(
      RECONCILE_SCHEDULER_ID,
      { every: env.RECONCILE_INTERVAL_MS },
      { name: JOB_NAMES.reconcile, data: {} },
    );
  } else {
    await queues.maintenance.removeJobScheduler(RECONCILE_SCHEDULER_ID);
  }

  // Startup recovery: rebuild anything a crash or Redis data loss left behind.
  const startup = await reconcile(reconcileDeps, { fullSweep: true });
  logger.info({ concurrency: env.EMAIL_WORKER_CONCURRENCY, startup }, 'Workers started');

  return {
    emailWorker,
    reconcile: (reconcileOptions) => reconcile(reconcileDeps, reconcileOptions),
    async close() {
      // Worker.close() waits for in-flight jobs to finish before resolving.
      await Promise.allSettled([emailWorker.close(), maintenanceWorker.close()]);
      await closeQueues(queues);
      transports.close();
      await Promise.allSettled([
        closeRedisConnection(redis),
        closeRedisConnection(bullConnection),
        pool.end(),
      ]);
    },
  };
}
