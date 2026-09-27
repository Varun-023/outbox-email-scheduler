import {
  char,
  index,
  int,
  mediumtext,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { utcDatetime, uuidColumn } from './columns';
import { senders } from './senders';
import { users } from './users';

export const campaigns = mysqlTable(
  'campaigns',
  {
    id: uuidColumn('id').primaryKey(),
    userId: uuidColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuidColumn('sender_id')
      .notNull()
      .references(() => senders.id, { onDelete: 'restrict' }),
    subject: varchar('subject', { length: 255 }).notNull(),
    bodyHtml: mediumtext('body_html').notNull(),
    bodyText: mediumtext('body_text').notNull(),
    previewText: varchar('preview_text', { length: 200 }).notNull(),
    startAt: utcDatetime('start_at').notNull(),
    /** Effective values after applying the sender floor/cap. */
    delayBetweenMs: int('delay_between_ms', { unsigned: true }).notNull(),
    hourlyLimit: int('hourly_limit', { unsigned: true }).notNull(),
    recipientCount: int('recipient_count', { unsigned: true }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    /** Set once every email job is in Redis; NULL rows are re-enqueued by the reconciler. */
    enqueuedAt: utcDatetime('enqueued_at'),
    createdAt: utcDatetime('created_at').notNull(),
    updatedAt: utcDatetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_campaigns_user_idem').on(table.userId, table.idempotencyKey),
    index('ix_campaigns_enqueue').on(table.enqueuedAt, table.createdAt),
    index('ix_campaigns_sender').on(table.senderId),
  ],
);

export type CampaignRow = typeof campaigns.$inferSelect;
