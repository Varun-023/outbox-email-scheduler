import { createPool, type Pool } from 'mysql2/promise';

export interface DatabasePoolOptions {
  url: string;
  connectionLimit: number;
}

/**
 * Creates the MySQL connection pool. Dates are exchanged in UTC (`timezone: 'Z'`) to match
 * the server's default-time-zone=+00:00, and multi-statement queries stay disabled.
 */
export function createDatabasePool(options: DatabasePoolOptions): Pool {
  return createPool({
    uri: options.url,
    connectionLimit: options.connectionLimit,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    timezone: 'Z',
    charset: 'UTF8MB4_0900_AI_CI',
    multipleStatements: false,
  });
}

export async function pingDatabase(pool: Pool): Promise<void> {
  await pool.query('SELECT 1');
}
