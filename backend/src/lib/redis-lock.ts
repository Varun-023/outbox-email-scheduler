import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

// Delete only if we still own the lock, so an expired-and-reacquired lock is never released.
const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

export interface LockHandle {
  release(): Promise<void>;
}

/** Best-effort mutual exclusion across processes (SET NX PX). Returns null when already held. */
export async function tryAcquireLock(
  redis: Redis,
  key: string,
  ttlMs: number,
): Promise<LockHandle | null> {
  const token = randomUUID();
  const acquired = await redis.set(key, token, 'PX', ttlMs, 'NX');
  if (acquired !== 'OK') return null;
  return {
    release: async () => {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    },
  };
}
