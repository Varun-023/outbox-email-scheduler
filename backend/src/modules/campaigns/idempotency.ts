import { createHash } from 'node:crypto';

/** JSON with object keys sorted, so equal requests always hash the same. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Fingerprint of a create-campaign request. Replaying an Idempotency-Key with the same
 * fingerprint returns the original campaign; a different fingerprint is rejected.
 */
export function computeRequestHash(request: unknown): string {
  return createHash('sha256').update(canonicalJson(request)).digest('hex');
}
