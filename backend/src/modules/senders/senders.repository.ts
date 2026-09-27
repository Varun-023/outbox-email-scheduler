import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client';
import { senders, type SenderRow } from '../../db/schema';

export type NewSenderRow = typeof senders.$inferInsert;

export class SendersRepository {
  constructor(private readonly db: Database) {}

  listActiveByUser(userId: string): Promise<SenderRow[]> {
    return this.db
      .select()
      .from(senders)
      .where(and(eq(senders.userId, userId), eq(senders.isActive, true)))
      .orderBy(asc(senders.createdAt), asc(senders.id));
  }

  /** Tenant-scoped lookup: another user's sender is indistinguishable from a missing one. */
  async findActiveOwned(id: string, userId: string): Promise<SenderRow | undefined> {
    const [row] = await this.db
      .select()
      .from(senders)
      .where(and(eq(senders.id, id), eq(senders.userId, userId), eq(senders.isActive, true)))
      .limit(1);
    return row;
  }

  async insertMany(rows: NewSenderRow[]): Promise<void> {
    if (rows.length > 0) await this.db.insert(senders).values(rows);
  }
}
