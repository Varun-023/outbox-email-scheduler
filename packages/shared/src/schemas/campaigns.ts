import { z } from 'zod';

/** Printable ASCII, 1–64 characters. The dashboard sends one UUID per compose session. */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7E]{1,64}$/;
export const idempotencyKeySchema = z
  .string({ error: 'Idempotency-Key header is required' })
  .regex(IDEMPOTENCY_KEY_PATTERN, 'Idempotency-Key must be 1-64 printable ASCII characters');

export const MAX_SUBJECT_LENGTH = 255;
export const MAX_BODY_HTML_BYTES = 256 * 1024;
export const MAX_DELAY_BETWEEN_EMAILS_SECONDS = 3600;

/** UTF-8 byte length without relying on DOM or Node globals (this package runs in both). */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes;
}

export const recipientInputSchema = z.strictObject({
  email: z.string().max(320),
  name: z.string().trim().max(255).optional(),
});

export const createCampaignRequestSchema = z.strictObject({
  senderId: z.uuid(),
  // Header injection guard: line breaks in a subject are collapsed to spaces.
  subject: z
    .string()
    .transform((value) => value.replace(/[\r\n]+/g, ' ').trim())
    .pipe(z.string().min(1, 'Subject is required').max(MAX_SUBJECT_LENGTH)),
  bodyHtml: z
    .string()
    .min(1, 'Body is required')
    .refine((html) => utf8ByteLength(html) <= MAX_BODY_HTML_BYTES, {
      message: 'Body must be at most 256 KB',
    }),
  recipients: z.array(recipientInputSchema).min(1, 'At least one recipient is required'),
  startAt: z.iso.datetime({ offset: true }).optional(),
  delayBetweenEmailsSeconds: z.int().min(0).max(MAX_DELAY_BETWEEN_EMAILS_SECONDS).optional(),
  hourlyLimit: z.int().min(1).optional(),
});
export type CreateCampaignRequest = z.input<typeof createCampaignRequestSchema>;
export type ParsedCreateCampaignRequest = z.output<typeof createCampaignRequestSchema>;

export interface CampaignSummary {
  id: string;
  senderId: string;
  subject: string;
  recipientCount: number;
  startAt: string;
  effectiveDelaySeconds: number;
  effectiveHourlyLimit: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  /** "pending" means the rows are saved but jobs are not in Redis yet; recovery enqueues them. */
  queueStatus: 'queued' | 'pending';
  createdAt: string;
}

export interface CreateCampaignResponse {
  campaign: CampaignSummary;
  recipients: { accepted: number; duplicatesRemoved: number };
}
