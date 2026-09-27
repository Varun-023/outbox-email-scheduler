import {
  boolean,
  int,
  mysqlEnum,
  mysqlTable,
  smallint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { utcDatetime, uuidColumn } from './columns';
import { users } from './users';

export const senders = mysqlTable(
  'senders',
  {
    id: uuidColumn('id').primaryKey(),
    userId: uuidColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 100 }).notNull(),
    fromName: varchar('from_name', { length: 255 }).notNull(),
    fromEmail: varchar('from_email', { length: 320 }).notNull(),
    provider: mysqlEnum('provider', ['ethereal']).notNull().default('ethereal'),
    smtpHost: varchar('smtp_host', { length: 255 }).notNull(),
    smtpPort: smallint('smtp_port', { unsigned: true }).notNull(),
    smtpSecure: boolean('smtp_secure').notNull(),
    smtpUser: varchar('smtp_user', { length: 320 }).notNull(),
    /** AES-256-GCM ciphertext (`v1:iv:ciphertext:tag`); never returned by the API. */
    smtpPassEnc: varchar('smtp_pass_enc', { length: 512 }).notNull(),
    /** Per-sender overrides; NULL means the environment default applies. */
    hourlyLimit: int('hourly_limit', { unsigned: true }),
    minDelayMs: int('min_delay_ms', { unsigned: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: utcDatetime('created_at').notNull(),
    updatedAt: utcDatetime('updated_at').notNull(),
  },
  (table) => [uniqueIndex('uq_senders_user_from').on(table.userId, table.fromEmail)],
);

export type SenderRow = typeof senders.$inferSelect;
