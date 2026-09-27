import {
  createCampaignRequestSchema,
  idempotencyKeySchema,
  isValidEmail,
  normalizeEmail,
  type AuthUser,
  type CampaignSummary,
  type CreateCampaignResponse,
  type ErrorDetail,
  type ParsedCreateCampaignRequest,
} from '@outbox/shared';
import type { Queue } from 'bullmq';
import type { Logger } from 'pino';
import { isDuplicateKeyError } from '../../db/errors';
import type { CampaignRow, NewEmailRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import { newId } from '../../lib/ids';
import { prepareEmailBody } from '../../lib/sanitize';
import { enqueueEmailJobs, JOB_NAMES, type SendEmailJobData } from '../../queue/queues';
import type { SendersService } from '../senders/senders.service';
import type { CampaignsRepository, NewCampaignRow } from './campaigns.repository';
import { computeRequestHash } from './idempotency';
import { planSchedule } from './schedule-planner';

const MAX_REPORTED_INVALID = 20;
const PAST_START_TOLERANCE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ENQUEUE_TIMEOUT_MS = 5_000;

export interface CampaignsConfig {
  maxRecipients: number;
  maxScheduleAheadDays: number;
  windowMs: number;
}

export interface CreateCampaignResult {
  status: 200 | 201;
  replayed: boolean;
  body: CreateCampaignResponse;
}

interface NormalizedRecipients {
  accepted: { email: string; name: string | null }[];
  duplicatesRemoved: number;
}

const validationError = (message: string, details: ErrorDetail[]) =>
  new AppError(400, 'VALIDATION_ERROR', message, details);

/** Normalises, validates and de-duplicates recipients (first occurrence wins). */
export function normalizeRecipients(
  recipients: ParsedCreateCampaignRequest['recipients'],
  maxRecipients: number,
): NormalizedRecipients {
  const seen = new Set<string>();
  const accepted: NormalizedRecipients['accepted'] = [];
  const invalid: ErrorDetail[] = [];
  let invalidCount = 0;
  let duplicatesRemoved = 0;

  recipients.forEach((recipient, index) => {
    const email = normalizeEmail(recipient.email);
    if (!isValidEmail(email)) {
      invalidCount += 1;
      if (invalid.length < MAX_REPORTED_INVALID) {
        invalid.push({ path: `recipients[${index}].email`, message: 'Invalid email address' });
      }
      return;
    }
    if (seen.has(email)) {
      duplicatesRemoved += 1;
      return;
    }
    seen.add(email);
    accepted.push({ email, name: recipient.name ? recipient.name : null });
  });

  if (invalidCount > 0) {
    throw validationError(`${invalidCount} recipient address(es) are invalid`, invalid);
  }
  if (accepted.length > maxRecipients) {
    throw validationError('Too many recipients', [
      { path: 'recipients', message: `At most ${maxRecipients} recipients per campaign` },
    ]);
  }
  return { accepted, duplicatesRemoved };
}

export class CampaignsService {
  constructor(
    private readonly deps: {
      repository: CampaignsRepository;
      senders: SendersService;
      emailQueue: Queue<SendEmailJobData>;
      searchSyncQueue?: Queue;
      config: CampaignsConfig;
      logger: Logger;
    },
  ) {}

  async create(
    user: AuthUser,
    idempotencyKeyHeader: string | undefined,
    body: unknown,
  ): Promise<CreateCampaignResult> {
    const keyResult = idempotencyKeySchema.safeParse(idempotencyKeyHeader);
    if (!keyResult.success) {
      throw validationError('Invalid Idempotency-Key header', [
        { path: 'Idempotency-Key', message: keyResult.error.issues[0]?.message ?? 'Invalid' },
      ]);
    }
    const idempotencyKey = keyResult.data;
    const request = createCampaignRequestSchema.parse(body);
    const { repository, config } = this.deps;

    const recipients = normalizeRecipients(request.recipients, config.maxRecipients);
    const sender = await this.deps.senders.requireOwned(user.id, request.senderId);
    const limits = this.deps.senders.limitsFor(sender);

    if (request.hourlyLimit !== undefined && request.hourlyLimit > limits.hourlyLimit) {
      throw validationError('Hourly limit exceeds the sender limit', [
        { path: 'hourlyLimit', message: `Must be at most ${limits.hourlyLimit} for this sender` },
      ]);
    }
    const hourlyLimit = request.hourlyLimit ?? limits.hourlyLimit;
    const delayBetweenMs = Math.max(
      (request.delayBetweenEmailsSeconds ?? 0) * 1000,
      limits.minDelayMs,
    );

    const now = new Date();
    const requestedStart = request.startAt ? new Date(request.startAt) : now;
    if (requestedStart.getTime() < now.getTime() - PAST_START_TOLERANCE_MS) {
      throw validationError('Start time is in the past', [
        { path: 'startAt', message: 'Must be now or in the future' },
      ]);
    }
    if (requestedStart.getTime() > now.getTime() + config.maxScheduleAheadDays * DAY_MS) {
      throw validationError('Start time is too far ahead', [
        { path: 'startAt', message: `Must be within ${config.maxScheduleAheadDays} days` },
      ]);
    }
    const startAt = requestedStart < now ? now : requestedStart;

    const prepared = prepareEmailBody(request.bodyHtml);
    if (!prepared.text) {
      throw validationError('Body has no content', [
        { path: 'bodyHtml', message: 'Must contain some text after formatting is cleaned' },
      ]);
    }

    // Hash the request as sent (not derived values such as "now"), so an identical retry matches.
    const requestHash = computeRequestHash({
      senderId: request.senderId,
      subject: request.subject,
      bodyHtml: request.bodyHtml,
      recipients: recipients.accepted,
      startAt: request.startAt ?? null,
      delayBetweenEmailsSeconds: request.delayBetweenEmailsSeconds ?? null,
      hourlyLimit: request.hourlyLimit ?? null,
    });

    const existing = await repository.findByIdempotencyKey(user.id, idempotencyKey);
    if (existing) return this.replay(existing, requestHash, recipients.duplicatesRemoved);

    const planned = planSchedule({
      count: recipients.accepted.length,
      startAt,
      hourlyLimit,
      gapMs: delayBetweenMs,
      windowMs: config.windowMs,
    });

    const campaignId = newId();
    const campaign: NewCampaignRow = {
      id: campaignId,
      userId: user.id,
      senderId: sender.id,
      subject: request.subject,
      bodyHtml: prepared.html,
      bodyText: prepared.text,
      previewText: prepared.preview,
      startAt,
      delayBetweenMs,
      hourlyLimit,
      recipientCount: recipients.accepted.length,
      idempotencyKey,
      requestHash,
      createdAt: now,
      updatedAt: now,
    };
    const emailRows: NewEmailRow[] = recipients.accepted.map((recipient, index) => {
      const scheduledAt = planned[index] as Date;
      return {
        id: newId(),
        campaignId,
        userId: user.id,
        senderId: sender.id,
        recipientEmail: recipient.email,
        recipientName: recipient.name,
        seqNo: index,
        status: 'scheduled',
        scheduledAt,
        originalScheduledAt: scheduledAt,
        createdAt: now,
        updatedAt: now,
      };
    });

    try {
      await repository.createWithEmails(campaign, emailRows);
    } catch (err) {
      // A concurrent request with the same key committed first: answer as a replay.
      if (isDuplicateKeyError(err, 'uq_campaigns_user_idem')) {
        const winner = await repository.findByIdempotencyKey(user.id, idempotencyKey);
        if (winner) return this.replay(winner, requestHash, recipients.duplicatesRemoved);
      }
      throw err;
    }

    if (this.deps.searchSyncQueue) {
      this.deps.searchSyncQueue
        .add(
          JOB_NAMES.indexEmails,
          { emailIds: emailRows.map((r) => r.id) },
          { jobId: `idx-${campaignId}` },
        )
        .catch((err) => {
          this.deps.logger.warn({ err, campaignId }, 'Could not enqueue search sync for campaign');
        });
    }

    const queueStatus = await this.enqueue(
      campaignId,
      emailRows.map((row) => ({
        emailId: row.id,
        campaignId,
        senderId: sender.id,
        userId: user.id,
        to: row.recipientEmail,
        scheduledAt: row.scheduledAt,
      })),
    );

    return {
      status: 201,
      replayed: false,
      body: {
        campaign: this.summary(
          campaign,
          { first: planned[0] as Date, last: planned[planned.length - 1] as Date },
          queueStatus,
        ),
        recipients: {
          accepted: recipients.accepted.length,
          duplicatesRemoved: recipients.duplicatesRemoved,
        },
      },
    };
  }

  /**
   * MySQL is the source of truth: if Redis is unavailable after the commit, the campaign is
   * still accepted as "pending" and the reconciler enqueues its jobs later.
   */
  private async enqueue(
    campaignId: string,
    jobs: Parameters<typeof enqueueEmailJobs>[1],
  ): Promise<CampaignSummary['queueStatus']> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        enqueueEmailJobs(this.deps.emailQueue, jobs),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Enqueue timed out after ${ENQUEUE_TIMEOUT_MS} ms`)),
            ENQUEUE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      this.deps.logger.warn({ err, campaignId }, 'Enqueue failed; the reconciler will retry');
      return 'pending';
    } finally {
      clearTimeout(timer);
    }
    try {
      await this.deps.repository.markEnqueued(campaignId, new Date());
    } catch (err) {
      // Jobs are in Redis; the reconciler re-adds them (a no-op) and sets the marker.
      this.deps.logger.warn({ err, campaignId }, 'Could not record enqueued_at');
    }
    return 'queued';
  }

  private async replay(
    existing: CampaignRow,
    requestHash: string,
    duplicatesRemoved: number,
  ): Promise<CreateCampaignResult> {
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        422,
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
      );
    }
    const bounds = await this.deps.repository.plannedBounds(existing.id);
    const planned = bounds ?? { first: existing.startAt, last: existing.startAt };
    return {
      status: 200,
      replayed: true,
      body: {
        campaign: this.summary(existing, planned, existing.enqueuedAt ? 'queued' : 'pending'),
        recipients: { accepted: existing.recipientCount, duplicatesRemoved },
      },
    };
  }

  private summary(
    row: Pick<
      CampaignRow,
      | 'id'
      | 'senderId'
      | 'subject'
      | 'recipientCount'
      | 'startAt'
      | 'delayBetweenMs'
      | 'hourlyLimit'
      | 'createdAt'
    >,
    planned: { first: Date; last: Date },
    queueStatus: CampaignSummary['queueStatus'],
  ): CampaignSummary {
    return {
      id: row.id,
      senderId: row.senderId,
      subject: row.subject,
      recipientCount: row.recipientCount,
      startAt: row.startAt.toISOString(),
      effectiveDelaySeconds: row.delayBetweenMs / 1000,
      effectiveHourlyLimit: row.hourlyLimit,
      firstScheduledAt: planned.first.toISOString(),
      lastScheduledAt: planned.last.toISOString(),
      queueStatus,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
