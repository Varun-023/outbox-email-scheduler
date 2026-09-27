/**
 * Generates a unique idempotency key conforming to ASCII 1-64 characters.
 */
export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'idemp-' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}
