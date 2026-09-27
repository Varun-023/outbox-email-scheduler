import { mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { utcDatetime, uuidColumn } from './columns';

export const users = mysqlTable(
  'users',
  {
    id: uuidColumn('id').primaryKey(),
    googleSub: varchar('google_sub', { length: 255 }).notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    avatarUrl: varchar('avatar_url', { length: 2048 }),
    createdAt: utcDatetime('created_at').notNull(),
    updatedAt: utcDatetime('updated_at').notNull(),
    lastLoginAt: utcDatetime('last_login_at').notNull(),
  },
  (table) => [uniqueIndex('uq_users_google_sub').on(table.googleSub)],
);

export type UserRow = typeof users.$inferSelect;
