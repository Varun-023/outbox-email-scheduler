const ER_DUP_ENTRY = 1062;
const ER_LOCK_WAIT_TIMEOUT = 1205;
const ER_LOCK_DEADLOCK = 1213;
const ER_CON_COUNT_ERROR = 1040;

const CONNECTION_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ER_CON_COUNT_ERROR',
]);

interface MysqlErrorLike {
  errno?: number;
  code?: string;
  sqlMessage?: string;
  message?: string;
  cause?: unknown;
}

/** Drizzle may wrap driver errors, so walk the `cause` chain to find the mysql2 error. */
function findMysqlError(err: unknown): MysqlErrorLike | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as MysqlErrorLike;
    if (typeof candidate.errno === 'number' || typeof candidate.code === 'string') {
      return candidate;
    }
    current = candidate.cause;
  }
  return undefined;
}

/** True for a unique-key violation, optionally on a specific key (e.g. "uq_campaigns_user_idem"). */
export function isDuplicateKeyError(err: unknown, keyName?: string): boolean {
  const mysqlError = findMysqlError(err);
  if (mysqlError?.errno !== ER_DUP_ENTRY) return false;
  if (!keyName) return true;
  return (mysqlError.sqlMessage ?? mysqlError.message ?? '').includes(keyName);
}

/** Deadlocks and lock-wait timeouts: the whole transaction can safely be retried. */
export function isRetryableTransactionError(err: unknown): boolean {
  const errno = findMysqlError(err)?.errno;
  return errno === ER_LOCK_DEADLOCK || errno === ER_LOCK_WAIT_TIMEOUT;
}

export function isConnectionError(err: unknown): boolean {
  const mysqlError = findMysqlError(err);
  if (!mysqlError) return false;
  return (
    mysqlError.errno === ER_CON_COUNT_ERROR ||
    (mysqlError.code !== undefined && CONNECTION_ERROR_CODES.has(mysqlError.code))
  );
}

/** Errors worth retrying later without consuming a job attempt. */
export function isDatabaseUnavailableError(err: unknown): boolean {
  return isConnectionError(err) || isRetryableTransactionError(err);
}

/** Runs `work` (normally one transaction), retrying deadlocks and lock-wait timeouts with jitter. */
export async function withTransactionRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      if (attempt >= attempts || !isRetryableTransactionError(err)) throw err;
      const backoffMs = 25 * 2 ** attempt + Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}
