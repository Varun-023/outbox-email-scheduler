import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Encrypts secrets at rest (SMTP passwords, Slack tokens and webhooks) with AES-256-GCM.
 * Output format: `v1:<iv>:<ciphertext>:<tag>` (base64url); the version prefix allows key rotation.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('Encryption key must be 32 bytes (base64-encoded)');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, ciphertext, tag]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join(':');
  }

  decrypt(payload: string): string {
    const [version, iv, ciphertext, tag] = payload.split(':');
    if (version !== VERSION || !iv || ciphertext === undefined || !tag) {
      throw new Error('Unrecognised encrypted payload');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
    const authTag = Buffer.from(tag, 'base64url');
    if (authTag.length !== TAG_BYTES) throw new Error('Unrecognised encrypted payload');
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
