import { z } from 'zod';

export const EMAIL_STATUSES = ['scheduled', 'sending', 'sent', 'failed'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Scheduled tab = scheduled + sending; Sent tab = sent + failed. */
export const EMAIL_FOLDERS = ['scheduled', 'sent'] as const;
export type EmailFolder = (typeof EMAIL_FOLDERS)[number];

export function folderOf(status: EmailStatus): EmailFolder {
  return status === 'sent' || status === 'failed' ? 'sent' : 'scheduled';
}

export const DEFERRED_REASONS = ['sender_hourly_limit', 'campaign_hourly_limit'] as const;
export type DeferredReason = (typeof DEFERRED_REASONS)[number];

export const listEmailsQuerySchema = z
  .strictObject({
    folder: z.enum(EMAIL_FOLDERS),
    status: z.enum(EMAIL_STATUSES).optional(),
    rescheduled: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    senderId: z.uuid().optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((query, ctx) => {
    if (query.status && folderOf(query.status) !== query.folder) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: `Status "${query.status}" does not belong to the ${query.folder} folder`,
      });
    }
  });
export type ListEmailsQuery = z.input<typeof listEmailsQuerySchema>;

export interface EmailSummary {
  id: string;
  campaignId: string;
  to: string;
  toName: string | null;
  subject: string;
  preview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  completedAt: string | null;
  deferCount: number;
  lastDeferredReason: DeferredReason | null;
  sender: { id: string; fromEmail: string };
}

export interface EmailDetail extends EmailSummary {
  bodyHtml: string;
  fromName: string;
  attemptCount: number;
  messageId: string | null;
  previewUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  originalScheduledAt: string;
  campaign: {
    id: string;
    effectiveDelaySeconds: number;
    effectiveHourlyLimit: number;
    recipientCount: number;
  };
}

export interface ListEmailsResponse {
  items: EmailSummary[];
  nextCursor: string | null;
}

export interface EmailCounts {
  scheduled: number;
  sent: number;
}
