import { mysqlEnum, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { utcDatetime, uuidColumn } from './columns';
import { users } from './users';

export const slackConnections = mysqlTable(
  'slack_connections',
  {
    id: uuidColumn('id').primaryKey(),
    userId: uuidColumn('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    teamId: varchar('team_id', { length: 32 }).notNull(),
    teamName: varchar('team_name', { length: 255 }).notNull(),
    channelId: varchar('channel_id', { length: 32 }).notNull(),
    channelName: varchar('channel_name', { length: 255 }).notNull(),
    appId: varchar('app_id', { length: 32 }).notNull(),
    botUserId: varchar('bot_user_id', { length: 32 }),
    slackUserId: varchar('slack_user_id', { length: 32 }),
    scopes: varchar('scopes', { length: 512 }).notNull(),
    /** Encrypted secrets; cleared on disconnect. */
    webhookUrlEnc: varchar('webhook_url_enc', { length: 1024 }),
    botTokenEnc: varchar('bot_token_enc', { length: 1024 }),
    status: mysqlEnum('status', ['active', 'revoked', 'invalid']).notNull(),
    lastNotifiedAt: utcDatetime('last_notified_at'),
    lastError: varchar('last_error', { length: 500 }),
    connectedAt: utcDatetime('connected_at').notNull(),
    revokedAt: utcDatetime('revoked_at'),
    createdAt: utcDatetime('created_at').notNull(),
    updatedAt: utcDatetime('updated_at').notNull(),
  },
  (table) => [uniqueIndex('uq_slack_connections_user').on(table.userId)],
);

export type SlackConnectionRow = typeof slackConnections.$inferSelect;
