import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabasePool } from '../../src/db/client';
import { requireTestEnv } from '../helpers/test-env';

// The global setup dropped every table and ran all migrations against the empty test database.
const env = requireTestEnv(['DATABASE_URL_TEST']);
let pool: Pool;

beforeAll(() => {
  pool = createDatabasePool({ url: env.DATABASE_URL_TEST, connectionLimit: 2 });
});
afterAll(() => pool.end());

async function rows(sql: string): Promise<RowDataPacket[]> {
  const [result] = await pool.query<RowDataPacket[]>(sql);
  return result;
}

describe('migration from an empty database', () => {
  it('creates exactly the application tables plus the migration history', async () => {
    const tables = await rows(
      `SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
    );
    const history = await rows('SELECT COUNT(*) AS applied FROM __drizzle_migrations');

    expect(tables.map((table) => table.name)).toEqual([
      '__drizzle_migrations',
      'campaigns',
      'emails',
      'senders',
      'slack_connections',
      'users',
    ]);
    expect(new Set(tables.map((table) => table.engine))).toEqual(new Set(['InnoDB']));
    expect(history[0]?.applied).toBe(1);
  });

  it('uses CHAR(36) ids, DATETIME(3) timestamps, MEDIUMTEXT bodies and ENUM statuses', async () => {
    const columns = await rows(
      `SELECT CONCAT(TABLE_NAME, '.', COLUMN_NAME) AS name, COLUMN_TYPE AS type
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
         AND CONCAT(TABLE_NAME, '.', COLUMN_NAME) IN
           ('users.id','emails.id','emails.claim_token','emails.scheduled_at','campaigns.body_html',
            'campaigns.body_text','emails.status','slack_connections.status','senders.provider')`,
    );
    const types = Object.fromEntries(columns.map((column) => [column.name, column.type]));

    expect(types).toEqual({
      'users.id': 'char(36)',
      'emails.id': 'char(36)',
      'emails.claim_token': 'char(36)',
      'emails.scheduled_at': 'datetime(3)',
      'campaigns.body_html': 'mediumtext',
      'campaigns.body_text': 'mediumtext',
      'emails.status': "enum('scheduled','sending','sent','failed')",
      'slack_connections.status': "enum('active','revoked','invalid')",
      'senders.provider': "enum('ethereal')",
    });
  });

  it('stores folder and search_dirty as generated columns', async () => {
    const generated = await rows(
      `SELECT COLUMN_NAME AS name, EXTRA AS extra FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'emails' AND GENERATION_EXPRESSION <> ''
       ORDER BY COLUMN_NAME`,
    );

    expect(generated).toEqual([
      { name: 'folder', extra: 'STORED GENERATED' },
      { name: 'search_dirty', extra: 'STORED GENERATED' },
    ]);
  });

  it('creates exactly the planned indexes and unique constraints', async () => {
    const indexes = await rows(
      `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns
       FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME <> '__drizzle_migrations'
         AND INDEX_NAME <> 'PRIMARY'
       GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`,
    );

    expect(
      indexes.map(
        (index) => `${index.nonUnique ? 'index' : 'unique'} ${index.indexName}(${index.columns})`,
      ),
    ).toEqual([
      'index ix_campaigns_enqueue(enqueued_at,created_at)',
      'index ix_campaigns_sender(sender_id)',
      'unique uq_campaigns_user_idem(user_id,idempotency_key)',
      'index ix_emails_search_dirty(search_dirty,updated_at)',
      'index ix_emails_sender(sender_id)',
      'index ix_emails_status_lease(status,lease_until)',
      'index ix_emails_status_sched(status,scheduled_at)',
      'index ix_emails_user_folder_done(user_id,folder,completed_at)',
      'index ix_emails_user_folder_sched(user_id,folder,scheduled_at)',
      'unique uq_emails_campaign_recipient(campaign_id,recipient_email)',
      'unique uq_emails_campaign_seq(campaign_id,seq_no)',
      'unique uq_senders_user_from(user_id,from_email)',
      'unique uq_slack_connections_user(user_id)',
      'unique uq_users_google_sub(google_sub)',
    ]);
  });

  it('creates the foreign keys with the intended delete rules', async () => {
    const foreignKeys = await rows(
      `SELECT CONCAT(TABLE_NAME, '.', CONSTRAINT_NAME) AS name, REFERENCED_TABLE_NAME AS target,
              DELETE_RULE AS onDelete
       FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
       ORDER BY name`,
    );

    expect(foreignKeys.map((fk) => `${fk.name} -> ${fk.target} ${fk.onDelete}`)).toEqual([
      'campaigns.campaigns_sender_id_senders_id_fk -> senders RESTRICT',
      'campaigns.campaigns_user_id_users_id_fk -> users CASCADE',
      'emails.emails_campaign_id_campaigns_id_fk -> campaigns CASCADE',
      'emails.emails_sender_id_senders_id_fk -> senders RESTRICT',
      'emails.emails_user_id_users_id_fk -> users CASCADE',
      'senders.senders_user_id_users_id_fk -> users CASCADE',
      'slack_connections.slack_connections_user_id_users_id_fk -> users CASCADE',
    ]);
  });
});
