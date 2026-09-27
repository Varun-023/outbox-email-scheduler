import type { Redis } from 'ioredis';

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SendReceipt {
  messageId: string;
  response: string;
  previewUrl: string | null;
  sentAt: Date;
  claimToken: string;
}

/**
 * Proof that SMTP accepted a message, written to Redis immediately after `250 OK` and
 * before MySQL is updated. A retry that finds a receipt finalises the row without resending.
 */
export class SendReceiptStore {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
  ) {}

  private key(emailId: string): string {
    return `${this.keyPrefix}:receipt:${emailId}`;
  }

  async save(emailId: string, receipt: SendReceipt): Promise<void> {
    const key = this.key(emailId);
    const results = await this.redis
      .multi()
      .hset(key, {
        messageId: receipt.messageId,
        response: receipt.response,
        previewUrl: receipt.previewUrl ?? '',
        sentAt: receipt.sentAt.toISOString(),
        claimToken: receipt.claimToken,
      })
      .pexpire(key, RECEIPT_TTL_MS)
      .exec();
    const failure = results?.find(([err]) => err);
    if (!results || failure) {
      throw failure?.[0] ?? new Error('Could not store the send receipt');
    }
  }

  async get(emailId: string): Promise<SendReceipt | null> {
    const fields = await this.redis.hgetall(this.key(emailId));
    if (!fields.messageId || !fields.sentAt) return null;
    return {
      messageId: fields.messageId,
      response: fields.response ?? '',
      previewUrl: fields.previewUrl ? fields.previewUrl : null,
      sentAt: new Date(fields.sentAt),
      claimToken: fields.claimToken ?? '',
    };
  }
}
