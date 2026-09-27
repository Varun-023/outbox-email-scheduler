import type { Pool, RowDataPacket } from 'mysql2/promise';

/** Drops every table in the pool's current database (local reset and test setup only). */
export async function dropAllTables(pool: Pool): Promise<void> {
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query<RowDataPacket[]>(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()',
    );
    // FOREIGN_KEY_CHECKS is per session, hence one dedicated connection.
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of tables) {
      await connection.query('DROP TABLE IF EXISTS ??', [name]);
    }
    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    connection.release();
  }
}
