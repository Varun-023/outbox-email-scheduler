import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { campaigns } from './campaigns';
import { utcDatetime, uuidColumn } from './columns';
import { senders } from './senders';
import { users } from './users';

export const EMAIL_STATUS_VALUES = ['scheduled', 'sending', 'sent', 'failed'] as const;
export const DEFERRED_REASON_VALUES = ['sender_hourly_limit', 'campaign_hourly_limit'] as const;

/** One row per recipient: the unit of work. Its id is also the BullMQ job id and ES doc id. */
export const emails = mysqlTable(
  'emails',
  {
    id: uuidColumn('id').primaryKey(),
    campaignId: uuidColumn('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    userId: uuidColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderId: uuidColumn('sender_id')
      .notNull()
      .references(() => senders.id, { onDelete: 'restrict' }),
    recipientEmail: varchar('recipient_email', { length: 254 }).notNull(),
    recipientName: varchar('recipient_name', { length: 255 }),
    seqNo: int('seq_no', { unsigned: true }).notNull(),
    status: mysqlEnum('status', EMAIL_STATUS_VALUES).notNull().default('scheduled'),
    // MySQL has no partial indexes; this stored column gives the list indexes an equality prefix.
    folder: varchar('folder', { length: 9 })
      .$type<'scheduled' | 'sent'>()
      .generatedAlwaysAs(sql.raw("if(`status` in ('sent','failed'),'sent','scheduled')"), {
        mode: 'stored',
      }),
    scheduledAt: utcDatetime('scheduled_at').notNull(),
    originalScheduledAt: utcDatetime('original_scheduled_at').notNull(),
    deferCount: int('defer_count', { unsigned: true }).notNull().default(0),
    lastDeferredReason: mysqlEnum('last_deferred_reason', DEFERRED_REASON_VALUES),
    attemptCount: int('attempt_count', { unsigned: true }).notNull().default(0),
    claimToken: uuidColumn('claim_token'),
    leaseUntil: utcDatetime('lease_until'),
    sentAt: utcDatetime('sent_at'),
    failedAt: utcDatetime('failed_at'),
    completedAt: utcDatetime('completed_at'),
    messageId: varchar('message_id', { length: 255 }),
    smtpResponse: varchar('smtp_response', { length: 512 }),
    previewUrl: varchar('preview_url', { length: 512 }),
    errorCode: varchar('error_code', { length: 64 }),
    errorMessage: varchar('error_message', { length: 1000 }),
    version: int('version', { unsigned: true }).notNull().default(1),
    indexedVersion: int('indexed_version', { unsigned: true }).notNull().default(0),
    searchDirty: boolean('search_dirty').generatedAlwaysAs(
      sql.raw('(`indexed_version` < `version`)'),
      { mode: 'stored' },
    ),
    createdAt: utcDatetime('created_at').notNull(),
    updatedAt: utcDatetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('uq_emails_campaign_recipient').on(table.campaignId, table.recipientEmail),
    uniqueIndex('uq_emails_campaign_seq').on(table.campaignId, table.seqNo),
    index('ix_emails_user_folder_sched').on(table.userId, table.folder, table.scheduledAt),
    index('ix_emails_user_folder_done').on(table.userId, table.folder, table.completedAt),
    index('ix_emails_status_sched').on(table.status, table.scheduledAt),
    index('ix_emails_status_lease').on(table.status, table.leaseUntil),
    index('ix_emails_search_dirty').on(table.searchDirty, table.updatedAt),
    index('ix_emails_sender').on(table.senderId),
  ],
);

export type EmailRow = typeof emails.$inferSelect;
export type NewEmailRow = typeof emails.$inferInsert;
