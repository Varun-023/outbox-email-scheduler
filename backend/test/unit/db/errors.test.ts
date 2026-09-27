import { describe, expect, it, vi } from 'vitest';
import {
  isConnectionError,
  isDatabaseUnavailableError,
  isDuplicateKeyError,
  isRetryableTransactionError,
  withTransactionRetry,
} from '../../../src/db/errors';

const mysqlError = (errno: number, code: string, sqlMessage = '') =>
  Object.assign(new Error(sqlMessage || code), { errno, code, sqlMessage });

const duplicate = mysqlError(
  1062,
  'ER_DUP_ENTRY',
  "Duplicate entry 'u-k' for key 'campaigns.uq_campaigns_user_idem'",
);

describe('MySQL error helpers', () => {
  it('recognise duplicate keys, optionally by key name, even when wrapped', () => {
    const wrapped = new Error('Failed query', { cause: duplicate });

    expect(isDuplicateKeyError(duplicate)).toBe(true);
    expect(isDuplicateKeyError(wrapped, 'uq_campaigns_user_idem')).toBe(true);
    expect(isDuplicateKeyError(wrapped, 'uq_emails_campaign_recipient')).toBe(false);
    expect(isDuplicateKeyError(new Error('other'))).toBe(false);
  });

  it('classify deadlocks and lock-wait timeouts as retryable', () => {
    expect(isRetryableTransactionError(mysqlError(1213, 'ER_LOCK_DEADLOCK'))).toBe(true);
    expect(isRetryableTransactionError(mysqlError(1205, 'ER_LOCK_WAIT_TIMEOUT'))).toBe(true);
    expect(isRetryableTransactionError(duplicate)).toBe(false);
  });

  it('classify lost connections as the database being unavailable', () => {
    const lost = Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });

    expect(isConnectionError(lost)).toBe(true);
    expect(isConnectionError(mysqlError(1040, 'ER_CON_COUNT_ERROR'))).toBe(true);
    expect(isDatabaseUnavailableError(mysqlError(1213, 'ER_LOCK_DEADLOCK'))).toBe(true);
    expect(isDatabaseUnavailableError(duplicate)).toBe(false);
  });
});

describe('withTransactionRetry', () => {
  it('retries a deadlocked transaction and returns its result', async () => {
    const work = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(mysqlError(1213, 'ER_LOCK_DEADLOCK'))
      .mockResolvedValueOnce('committed');

    await expect(withTransactionRetry(work)).resolves.toBe('committed');
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt limit and never retries other errors', async () => {
    const deadlock = vi.fn(() => Promise.reject(mysqlError(1213, 'ER_LOCK_DEADLOCK')));
    const failing = vi.fn(() => Promise.reject(duplicate));

    await expect(withTransactionRetry(deadlock, 3)).rejects.toMatchObject({ errno: 1213 });
    expect(deadlock).toHaveBeenCalledTimes(3);
    await expect(withTransactionRetry(failing)).rejects.toBe(duplicate);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
