import { and, asc, eq, isNull, lt, max, min } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { withTransactionRetry } from '../../db/errors';
import { campaigns, emails, type CampaignRow, type NewEmailRow } from '../../db/schema';
import type { EmailJobSpec } from '../../queue/queues';

export type NewCampaignRow = typeof campaigns.$inferInsert;

const INSERT_CHUNK_SIZE = 500;

export class CampaignsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Inserts the campaign first (so an idempotency-key collision surfaces before any email
   * rows are written), then its emails in chunks, in one READ COMMITTED transaction.
   * Deadlocks and lock-wait timeouts retry the whole transaction.
   */
  async createWithEmails(campaign: NewCampaignRow, rows: readonly NewEmailRow[]): Promise<void> {
    await withTransactionRetry(() =>
      this.db.transaction(
        async (tx) => {
          await tx.insert(campaigns).values(campaign);
          for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
            await tx.insert(emails).values(rows.slice(start, start + INSERT_CHUNK_SIZE));
          }
        },
        { isolationLevel: 'read committed' },
      ),
    );
  }

  async findByIdempotencyKey(userId: string, key: string): Promise<CampaignRow | undefined> {
    const [row] = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.userId, userId), eq(campaigns.idempotencyKey, key)))
      .limit(1);
    return row;
  }

  async plannedBounds(campaignId: string): Promise<{ first: Date; last: Date } | undefined> {
    const [row] = await this.db
      .select({ first: min(emails.originalScheduledAt), last: max(emails.originalScheduledAt) })
      .from(emails)
      .where(eq(emails.campaignId, campaignId));
    if (!row?.first || !row.last) return undefined;
    return { first: row.first, last: row.last };
  }

  async markEnqueued(campaignId: string, at: Date): Promise<void> {
    await this.db
      .update(campaigns)
      .set({ enqueuedAt: at, updatedAt: at })
      .where(and(eq(campaigns.id, campaignId), isNull(campaigns.enqueuedAt)));
  }

  /** Campaigns committed to MySQL whose jobs never reached Redis (crash or Redis outage). */
  listNotEnqueued(createdBefore: Date, limit: number): Promise<Pick<CampaignRow, 'id'>[]> {
    return this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(isNull(campaigns.enqueuedAt), lt(campaigns.createdAt, createdBefore)))
      .orderBy(asc(campaigns.createdAt))
      .limit(limit);
  }

  async scheduledJobsFor(campaignId: string): Promise<EmailJobSpec[]> {
    const rows = await this.db
      .select({
        emailId: emails.id,
        campaignId: emails.campaignId,
        senderId: emails.senderId,
        userId: emails.userId,
        to: emails.recipientEmail,
        scheduledAt: emails.scheduledAt,
      })
      .from(emails)
      .where(and(eq(emails.campaignId, campaignId), eq(emails.status, 'scheduled')))
      .orderBy(asc(emails.seqNo));
    return rows;
  }
}
