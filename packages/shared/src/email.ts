/** RFC 5321 limits: 254 characters in total and 64 in the local part. */
export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

// Pragmatic ASCII address check: dot-atom local part and a hostname with an alphabetic TLD.
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalises a recipient for storage and de-duplication: trims, unwraps
 * `Name <address>` forms and lower-cases the whole address.
 */
export function normalizeEmail(raw: string): string {
  let value = raw.trim();
  const bracketed = /<([^<>]+)>\s*$/.exec(value);
  if (bracketed?.[1]) value = bracketed[1];
  return value.trim().toLowerCase();
}

/** Validates an address that has already been normalised with {@link normalizeEmail}. */
export function isValidEmail(email: string): boolean {
  if (email.length > MAX_EMAIL_LENGTH) return false;
  const at = email.lastIndexOf('@');
  if (at < 1 || at > MAX_LOCAL_PART_LENGTH) return false;
  return EMAIL_PATTERN.test(email);
}
