import { describe, expect, it } from 'vitest';
import { parseRecipientLine, parseRecipientsText } from './csv';

describe('csv utils', () => {
  describe('parseRecipientLine', () => {
    it('parses plain email address', () => {
      expect(parseRecipientLine('user@example.com')).toEqual({ email: 'user@example.com' });
    });

    it('parses Name <email@example.com>', () => {
      expect(parseRecipientLine('John Doe <john@example.com>')).toEqual({
        email: 'john@example.com',
        name: 'John Doe',
      });
    });

    it('parses email, name csv format', () => {
      expect(parseRecipientLine('john@example.com, John Doe')).toEqual({
        email: 'john@example.com',
        name: 'John Doe',
      });
    });

    it('parses name, email csv format', () => {
      expect(parseRecipientLine('John Doe, john@example.com')).toEqual({
        email: 'john@example.com',
        name: 'John Doe',
      });
    });

    it('returns null for invalid string', () => {
      expect(parseRecipientLine('not an email')).toBeNull();
      expect(parseRecipientLine('')).toBeNull();
    });
  });

  describe('parseRecipientsText', () => {
    it('parses multi-line text with header and deduplicates', () => {
      const input = `email,name
alice@example.com, Alice
bob@example.com, Bob
Alice <alice@example.com>
invalid-email
charlie@example.com`;

      const res = parseRecipientsText(input);
      expect(res.recipients).toHaveLength(3);
      expect(res.recipients[0]?.email).toBe('alice@example.com');
      expect(res.recipients[1]?.email).toBe('bob@example.com');
      expect(res.recipients[2]?.email).toBe('charlie@example.com');
      expect(res.duplicateCount).toBe(1);
      expect(res.invalidCount).toBe(1);
    });

    it('parses comma-separated emails on single line', () => {
      const input = 'a@b.com, c@d.com, e@f.com';
      const res = parseRecipientsText(input);
      expect(res.recipients).toHaveLength(3);
      expect(res.recipients.map((r) => r.email)).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
    });
  });
});
