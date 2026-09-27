import {
  listEmailsQuerySchema,
  type AuthUser,
  type EmailCounts,
  type EmailDetail,
  type EmailSummary,
  type ListEmailsResponse,
} from '@outbox/shared';
import { z } from 'zod';
import { AppError } from '../../lib/app-error';
import type { EmailsRepository, ListCursor } from './emails.repository';

type SummaryRow = Awaited<ReturnType<EmailsRepository['list']>>[number];

const cursorSchema = z.object({ t: z.iso.datetime(), id: z.uuid() });

export function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.time.toISOString(), id: cursor.id })).toString(
    'base64url',
  );
}

export function decodeCursor(value: string): ListCursor {
  try {
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    return { time: new Date(parsed.t), id: parsed.id };
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid cursor', [
      { path: 'cursor', message: 'Use the nextCursor value from a previous page' },
    ]);
  }
}

const iso = (date: Date | null) => (date ? date.toISOString() : null);

function toSummary(row: SummaryRow): EmailSummary {
  return {
    id: row.id,
    campaignId: row.campaignId,
    to: row.to,
    toName: row.toName,
    subject: row.subject,
    preview: row.preview,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    sentAt: iso(row.sentAt),
    completedAt: iso(row.completedAt),
    deferCount: row.deferCount,
    lastDeferredReason: row.lastDeferredReason,
    sender: { id: row.senderId, fromEmail: row.senderFromEmail },
  };
}

export class EmailsService {
  constructor(private readonly repository: EmailsRepository) {}

  async list(user: AuthUser, rawQuery: unknown): Promise<ListEmailsResponse> {
    const query = listEmailsQuerySchema.parse(rawQuery);
    const rows = await this.repository.list({
      userId: user.id,
      folder: query.folder,
      status: query.status,
      rescheduled: query.rescheduled,
      senderId: query.senderId,
      cursor: query.cursor ? decodeCursor(query.cursor) : undefined,
      limit: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const lastTime = last && (query.folder === 'scheduled' ? last.scheduledAt : last.completedAt);
    return {
      items: page.map(toSummary),
      nextCursor:
        rows.length > query.limit && last && lastTime
          ? encodeCursor({ time: lastTime, id: last.id })
          : null,
    };
  }

  counts(user: AuthUser): Promise<EmailCounts> {
    return this.repository.countByFolder(user.id);
  }

  async get(user: AuthUser, emailId: string): Promise<EmailDetail> {
    const row = await this.repository.findDetail(user.id, emailId);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Email not found');
    const { email, campaign, sender } = row;
    return {
      ...toSummary({
        id: email.id,
        campaignId: email.campaignId,
        to: email.recipientEmail,
        toName: email.recipientName,
        subject: campaign.subject,
        preview: campaign.previewText,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
        completedAt: email.completedAt,
        deferCount: email.deferCount,
        lastDeferredReason: email.lastDeferredReason,
        senderId: sender.id,
        senderFromEmail: sender.fromEmail,
      }),
      bodyHtml: campaign.bodyHtml,
      fromName: sender.fromName,
      attemptCount: email.attemptCount,
      messageId: email.messageId,
      previewUrl: email.previewUrl,
      errorCode: email.errorCode,
      errorMessage: email.errorMessage,
      originalScheduledAt: email.originalScheduledAt.toISOString(),
      campaign: {
        id: campaign.id,
        effectiveDelaySeconds: campaign.delayBetweenMs / 1000,
        effectiveHourlyLimit: campaign.hourlyLimit,
        recipientCount: campaign.recipientCount,
      },
    };
  }
}
