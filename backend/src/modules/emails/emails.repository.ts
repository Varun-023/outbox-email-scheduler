import type { DeferredReason, EmailFolder, EmailStatus } from '@outbox/shared';
import { and, asc, count, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import type { ResultSetHeader } from 'mysql2';
import type { Database } from '../../db/client';
import {
  campaigns,
  emails,
  senders,
  type CampaignRow,
  type EmailRow,
  type SenderRow,
} from '../../db/schema';

export interface ListCursor {
  time: Date;
  id: string;
}

export interface ListEmailsFilter {
  userId: string;
  folder: EmailFolder;
  status?: EmailStatus;
  rescheduled?: boolean;
  senderId?: string;
  cursor?: ListCursor;
  limit: number;
}

const summaryColumns = {
  id: emails.id,
  campaignId: emails.campaignId,
  to: emails.recipientEmail,
  toName: emails.recipientName,
  subject: campaigns.subject,
  preview: campaigns.previewText,
  status: emails.status,
  scheduledAt: emails.scheduledAt,
  sentAt: emails.sentAt,
  completedAt: emails.completedAt,
  deferCount: emails.deferCount,
  lastDeferredReason: emails.lastDeferredReason,
  senderId: senders.id,
  senderFromEmail: senders.fromEmail,
};

export interface EmailDetailRow {
  email: EmailRow;
  campaign: CampaignRow;
  sender: SenderRow;
}

/** Everything the worker needs to send one email. */
export interface SendableEmail {
  email: EmailRow;
  campaign: CampaignRow;
  sender: SenderRow;
}

export interface SendReceiptData {
  messageId: string;
  response: string;
  previewUrl: string | null;
  sentAt: Date;
}

const MAX_ERROR_MESSAGE = 1000;
const MAX_SMTP_RESPONSE = 512;

const truncate = (value: string, max: number) => (value.length > max ? value.slice(0, max) : value);

/** Every state transition bumps `version` (ES sync) and `updated_at`. */
const bump = (now: Date) => ({ version: sql`${emails.version} + 1`, updatedAt: now });

function affected(result: [ResultSetHeader, unknown]): boolean {
  return result[0].affectedRows === 1;
}

export class EmailsRepository {
  constructor(private readonly db: Database) {}

  // ─── Dashboard queries (always scoped by user) ──────────────────────────────────────

  async list(filter: ListEmailsFilter) {
    const conditions: (SQL | undefined)[] = [
      eq(emails.userId, filter.userId),
      eq(emails.folder, filter.folder),
      filter.status ? eq(emails.status, filter.status) : undefined,
      filter.senderId ? eq(emails.senderId, filter.senderId) : undefined,
      filter.rescheduled === true ? gt(emails.deferCount, 0) : undefined,
      filter.rescheduled === false ? eq(emails.deferCount, 0) : undefined,
    ];

    // Keyset pagination, written out rather than as a row constructor so MySQL uses the index.
    if (filter.folder === 'scheduled') {
      if (filter.cursor) {
        conditions.push(
          or(
            gt(emails.scheduledAt, filter.cursor.time),
            and(eq(emails.scheduledAt, filter.cursor.time), gt(emails.id, filter.cursor.id)),
          ),
        );
      }
      return this.db
        .select(summaryColumns)
        .from(emails)
        .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
        .innerJoin(senders, eq(senders.id, emails.senderId))
        .where(and(...conditions))
        .orderBy(asc(emails.scheduledAt), asc(emails.id))
        .limit(filter.limit);
    }

    if (filter.cursor) {
      conditions.push(
        or(
          lt(emails.completedAt, filter.cursor.time),
          and(eq(emails.completedAt, filter.cursor.time), lt(emails.id, filter.cursor.id)),
        ),
      );
    }
    return this.db
      .select(summaryColumns)
      .from(emails)
      .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
      .innerJoin(senders, eq(senders.id, emails.senderId))
      .where(and(...conditions))
      .orderBy(desc(emails.completedAt), desc(emails.id))
      .limit(filter.limit);
  }

  async countByFolder(userId: string): Promise<Record<EmailFolder, number>> {
    const rows = await this.db
      .select({ folder: emails.folder, total: count() })
      .from(emails)
      .where(eq(emails.userId, userId))
      .groupBy(emails.folder);
    const counts: Record<EmailFolder, number> = { scheduled: 0, sent: 0 };
    for (const row of rows) {
      if (row.folder === 'scheduled' || row.folder === 'sent') counts[row.folder] = row.total;
    }
    return counts;
  }

  async findDetail(userId: string, emailId: string): Promise<EmailDetailRow | undefined> {
    const [row] = await this.db
      .select({ email: emails, campaign: campaigns, sender: senders })
      .from(emails)
      .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
      .innerJoin(senders, eq(senders.id, emails.senderId))
      .where(and(eq(emails.id, emailId), eq(emails.userId, userId)))
      .limit(1);
    return row;
  }

  // ─── Worker state machine ──────────────────────────────────────────────────────────

  async findForSending(emailId: string): Promise<SendableEmail | undefined> {
    const [row] = await this.db
      .select({ email: emails, campaign: campaigns, sender: senders })
      .from(emails)
      .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
      .innerJoin(senders, eq(senders.id, emails.senderId))
      .where(eq(emails.id, emailId))
      .limit(1);
    return row;
  }

  /** scheduled → sending. Exactly one caller wins; everyone else sees false. */
  async claim(emailId: string, claimToken: string, leaseUntil: Date, now = new Date()) {
    return affected(
      await this.db
        .update(emails)
        .set({
          status: 'sending',
          claimToken,
          leaseUntil,
          attemptCount: sql`${emails.attemptCount} + 1`,
          ...bump(now),
        })
        .where(and(eq(emails.id, emailId), eq(emails.status, 'scheduled'))),
    );
  }

  /** Hourly window full: move the email to its later slot (it stays scheduled, never failed). */
  async defer(emailId: string, scheduledAt: Date, reason: DeferredReason, now = new Date()) {
    return affected(
      await this.db
        .update(emails)
        .set({
          scheduledAt,
          deferCount: sql`${emails.deferCount} + 1`,
          lastDeferredReason: reason,
          ...bump(now),
        })
        .where(and(eq(emails.id, emailId), eq(emails.status, 'scheduled'))),
    );
  }

  /**
   * sending → sent for the claim holder. A confirmed receipt also overrides an earlier
   * DELIVERY_UNCERTAIN verdict: proof of delivery beats a guess.
   */
  async markSent(emailId: string, claimToken: string, receipt: SendReceiptData, now = new Date()) {
    return affected(
      await this.db
        .update(emails)
        .set(this.sentFields(receipt, now))
        .where(
          and(
            eq(emails.id, emailId),
            or(
              and(eq(emails.status, 'sending'), eq(emails.claimToken, claimToken)),
              and(eq(emails.status, 'failed'), eq(emails.errorCode, 'DELIVERY_UNCERTAIN')),
            ),
          ),
        ),
    );
  }

  /** Recovery after a crash between SMTP success and the MySQL update. */
  async markSentFromReceipt(emailId: string, receipt: SendReceiptData, now = new Date()) {
    return affected(
      await this.db
        .update(emails)
        .set(this.sentFields(receipt, now))
        .where(and(eq(emails.id, emailId), eq(emails.status, 'sending'))),
    );
  }

  async markFailed(
    emailId: string,
    claimToken: string,
    errorCode: string,
    errorMessage: string,
    now = new Date(),
  ) {
    return affected(
      await this.db
        .update(emails)
        .set(this.failedFields(errorCode, errorMessage, now))
        .where(
          and(
            eq(emails.id, emailId),
            eq(emails.status, 'sending'),
            eq(emails.claimToken, claimToken),
          ),
        ),
    );
  }

  /** The claim's lease expired with no receipt: the send may or may not have happened. */
  async markUncertainIfLeaseExpired(emailId: string, now = new Date()) {
    return affected(
      await this.db
        .update(emails)
        .set(
          this.failedFields(
            'DELIVERY_UNCERTAIN',
            'The worker stopped while sending; delivery could not be confirmed, so the email was not resent',
            now,
          ),
        )
        .where(
          and(eq(emails.id, emailId), eq(emails.status, 'sending'), lt(emails.leaseUntil, now)),
        ),
    );
  }

  /** sending → scheduled after a transient SMTP failure; BullMQ retries with backoff. */
  async releaseClaim(
    emailId: string,
    claimToken: string,
    errorCode: string,
    errorMessage: string,
    now = new Date(),
  ) {
    return affected(
      await this.db
        .update(emails)
        .set({
          status: 'scheduled',
          claimToken: null,
          leaseUntil: null,
          errorCode,
          errorMessage: truncate(errorMessage, MAX_ERROR_MESSAGE),
          ...bump(now),
        })
        .where(
          and(
            eq(emails.id, emailId),
            eq(emails.status, 'sending'),
            eq(emails.claimToken, claimToken),
          ),
        ),
    );
  }

  /** UNCERTAIN_DELIVERY_POLICY=resend: return an expired claim to the queue (at-least-once). */
  async releaseExpiredClaim(emailId: string, now = new Date()) {
    return affected(
      await this.db
        .update(emails)
        .set({ status: 'scheduled', claimToken: null, leaseUntil: null, ...bump(now) })
        .where(
          and(eq(emails.id, emailId), eq(emails.status, 'sending'), lt(emails.leaseUntil, now)),
        ),
    );
  }

  // ─── Reconciler scans ──────────────────────────────────────────────────────────────

  /** Scheduled emails in (scheduled_at, id) order after the cursor; uses ix_emails_status_sched. */
  listScheduled(options: { before?: Date; after?: ListCursor; limit: number }) {
    const conditions: (SQL | undefined)[] = [
      eq(emails.status, 'scheduled'),
      options.before ? lt(emails.scheduledAt, options.before) : undefined,
      options.after
        ? or(
            gt(emails.scheduledAt, options.after.time),
            and(eq(emails.scheduledAt, options.after.time), gt(emails.id, options.after.id)),
          )
        : undefined,
    ];
    return this.db
      .select({
        emailId: emails.id,
        campaignId: emails.campaignId,
        senderId: emails.senderId,
        userId: emails.userId,
        to: emails.recipientEmail,
        scheduledAt: emails.scheduledAt,
      })
      .from(emails)
      .where(and(...conditions))
      .orderBy(asc(emails.scheduledAt), asc(emails.id))
      .limit(options.limit);
  }

  listExpiredLeases(now: Date, limit: number) {
    return this.db
      .select({ id: emails.id })
      .from(emails)
      .where(and(eq(emails.status, 'sending'), lt(emails.leaseUntil, now)))
      .limit(limit);
  }

  async findForIndexing(emailIds: string[]): Promise<SendableEmail[]> {
    if (emailIds.length === 0) return [];
    return this.db
      .select({ email: emails, campaign: campaigns, sender: senders })
      .from(emails)
      .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
      .innerJoin(senders, eq(senders.id, emails.senderId))
      .where(inArray(emails.id, emailIds));
  }

  async findSearchDirty(limit = 100): Promise<SendableEmail[]> {
    return this.db
      .select({ email: emails, campaign: campaigns, sender: senders })
      .from(emails)
      .innerJoin(campaigns, eq(campaigns.id, emails.campaignId))
      .innerJoin(senders, eq(senders.id, emails.senderId))
      .where(eq(emails.searchDirty, true))
      .limit(limit);
  }

  async markIndexed(items: { id: string; version: number }[]): Promise<void> {
    if (items.length === 0) return;
    for (const item of items) {
      await this.db
        .update(emails)
        .set({ indexedVersion: item.version })
        .where(eq(emails.id, item.id));
    }
  }

  private sentFields(receipt: SendReceiptData, now: Date) {
    return {
      status: 'sent' as const,
      sentAt: receipt.sentAt,
      completedAt: receipt.sentAt,
      failedAt: null,
      messageId: truncate(receipt.messageId, 255),
      smtpResponse: truncate(receipt.response, MAX_SMTP_RESPONSE),
      previewUrl: receipt.previewUrl ? truncate(receipt.previewUrl, 512) : null,
      claimToken: null,
      leaseUntil: null,
      errorCode: null,
      errorMessage: null,
      ...bump(now),
    };
  }

  private failedFields(errorCode: string, errorMessage: string, now: Date) {
    return {
      status: 'failed' as const,
      failedAt: now,
      completedAt: now,
      claimToken: null,
      leaseUntil: null,
      errorCode,
      errorMessage: truncate(errorMessage, MAX_ERROR_MESSAGE),
      ...bump(now),
    };
  }
}
