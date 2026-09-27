import { describe, expect, it } from 'vitest';
import { isValidEmail, normalizeEmail } from '../src';

describe('normalizeEmail', () => {
  it.each([
    ['  Tame@JMail.com ', 'tame@jmail.com'],
    ['John Smith <John.Smith@Acme.io>', 'john.smith@acme.io'],
    ['"Smith, John" <john@acme.io>  ', 'john@acme.io'],
    ['<lame@jmail.com>', 'lame@jmail.com'],
  ])('normalises %j to %j', (raw, expected) => {
    expect(normalizeEmail(raw)).toBe(expected);
  });
});

describe('isValidEmail', () => {
  it.each([
    'tame@jmail.com',
    'first.last+tag@sub.example.co.uk',
    "o'brien@example.ie",
    'x@xn--80ak6aa92e.com',
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    '',
    'plainaddress',
    '@missing-local.com',
    'missing-domain@',
    'two@@example.com',
    'dot.@example.com',
    '.dot@example.com',
    'double..dot@example.com',
    'user@-hyphen.com',
    'user@example.123',
    'user@localhost',
    'spaces in@example.com',
    `${'a'.repeat(65)}@example.com`,
    `user@${'a'.repeat(250)}.com`,
  ])('rejects %j', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});
