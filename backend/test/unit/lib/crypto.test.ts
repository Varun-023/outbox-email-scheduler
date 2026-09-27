import { describe, expect, it } from 'vitest';
import { SecretBox } from '../../../src/lib/crypto';

const key = Buffer.alloc(32, 3).toString('base64');

describe('SecretBox (AES-256-GCM)', () => {
  it('round-trips a secret and never stores the plaintext', () => {
    const box = new SecretBox(key);

    const encrypted = box.encrypt('smtp-password-123');

    expect(encrypted).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(encrypted).not.toContain('smtp-password-123');
    expect(box.decrypt(encrypted)).toBe('smtp-password-123');
  });

  it('uses a fresh IV every time', () => {
    const box = new SecretBox(key);

    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('detects tampering through the authentication tag', () => {
    const box = new SecretBox(key);
    const [version, iv, ciphertext, tag] = box.encrypt('secret').split(':');
    const flipped = Buffer.from(ciphertext as string, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    expect(() =>
      box.decrypt([version, iv, flipped.toString('base64url'), tag].join(':')),
    ).toThrow();
  });

  it('cannot be decrypted with a different key', () => {
    const encrypted = new SecretBox(key).encrypt('secret');
    const other = new SecretBox(Buffer.alloc(32, 4).toString('base64'));

    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('rejects malformed payloads and short keys', () => {
    expect(() => new SecretBox(key).decrypt('not-encrypted')).toThrow('Unrecognised');
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });
});
