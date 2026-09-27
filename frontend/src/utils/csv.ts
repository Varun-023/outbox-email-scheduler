import { isValidEmail, normalizeEmail } from '@outbox/shared';

export interface ParsedRecipient {
  email: string;
  name?: string;
}

export interface ParseRecipientsResult {
  recipients: ParsedRecipient[];
  invalidCount: number;
  duplicateCount: number;
  totalParsed: number;
}

/**
 * Extracts a name and an email from a text line.
 * Supports:
 * - "John Doe <john@example.com>"
 * - "john@example.com, John Doe"
 * - "John Doe, john@example.com"
 * - "john@example.com"
 */
export function parseRecipientLine(line: string): ParsedRecipient | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Format: Name <email@example.com>
  const angleMatch = /^(.*?)\s*<([^<>]+)>\s*$/.exec(trimmed);
  if (angleMatch) {
    const rawName = angleMatch[1]?.trim().replace(/^["']|["']$/g, '');
    const rawEmail = angleMatch[2]?.trim() || '';
    const email = normalizeEmail(rawEmail);
    if (isValidEmail(email)) {
      return { email, ...(rawName ? { name: rawName } : {}) };
    }
  }

  // Format: CSV with commas or tabs
  if (trimmed.includes(',') || trimmed.includes('\t')) {
    const parts = trimmed.split(/,|\t/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length >= 2) {
      const part0 = normalizeEmail(parts[0] ?? '');
      const part1 = normalizeEmail(parts[1] ?? '');

      if (isValidEmail(part0)) {
        const name = parts[1]?.trim();
        return { email: part0, ...(name ? { name } : {}) };
      }
      if (isValidEmail(part1)) {
        const name = parts[0]?.trim();
        return { email: part1, ...(name ? { name } : {}) };
      }
    }
  }

  // Format: plain email address
  const email = normalizeEmail(trimmed);
  if (isValidEmail(email)) {
    return { email };
  }

  return null;
}

/**
 * Parses raw text content (from CSV or TXT file or multi-line paste) into valid recipient records.
 */
export function parseRecipientsText(content: string): ParseRecipientsResult {
  const lines = content.split(/[\r\n]+/);
  const seenEmails = new Set<string>();
  const recipients: ParsedRecipient[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let totalParsed = 0;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;

    // Check if first line is a CSV header (e.g. "email,name" or "Email, Name")
    if (i === 0) {
      const lower = rawLine.toLowerCase();
      if (
        lower === 'email' ||
        lower === 'email,name' ||
        lower === 'name,email' ||
        lower.includes('email,')
      ) {
        continue;
      }
    }

    // A single line might also have comma-separated email addresses without names
    // e.g. "a@b.com, c@d.com, e@f.com"
    const commaSeparated = rawLine.split(',').map((s) => s.trim());
    if (commaSeparated.length > 2 && commaSeparated.every((s) => isValidEmail(normalizeEmail(s)))) {
      for (const single of commaSeparated) {
        totalParsed++;
        const email = normalizeEmail(single);
        if (seenEmails.has(email)) {
          duplicateCount++;
        } else {
          seenEmails.add(email);
          recipients.push({ email });
        }
      }
      continue;
    }

    totalParsed++;
    const parsed = parseRecipientLine(rawLine);
    if (!parsed) {
      invalidCount++;
      continue;
    }

    if (seenEmails.has(parsed.email)) {
      duplicateCount++;
    } else {
      seenEmails.add(parsed.email);
      recipients.push(parsed);
    }
  }

  return {
    recipients,
    invalidCount,
    duplicateCount,
    totalParsed,
  };
}
