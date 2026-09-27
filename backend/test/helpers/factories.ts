import { eq } from 'drizzle-orm';
import type { Database } from '../../src/db/client';
import {
  campaigns,
  emails,
  senders,
  users,
  type CampaignRow,
  type EmailRow,
  type SenderRow,
  type UserRow,
} from '../../src/db/schema';
import type { SecretBox } from '../../src/lib/crypto';
import { newId } from '../../src/lib/ids';
import { enqueueEmailJobs, type Queues } from '../../src/queue/queues';

export async function createUser(db: Database, overrides: Partial<UserRow> = {}): Promise<UserRow> {
  const now = new Date();
  const id = newId();
  const row: UserRow = {
    id,
    googleSub: `sub-${id}`,
    email: `user-${id.slice(-8)}@example.com`,
    name: 'Test User',
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
    ...overrides,
  };
  await db.insert(users).values(row);
  return row;
}

export async function createSender(
  db: Database,
  secrets: SecretBox,
  options: { userId: string; smtpPort: number; hourlyLimit?: number; minDelayMs?: number },
): Promise<SenderRow> {
  const now = new Date();
  const id = newId();
  const row: SenderRow = {
    id,
    userId: options.userId,
    label: 'Test sender',
    fromName: 'Test Sender',
    fromEmail: `sender-${id.slice(-8)}@ethereal.test`,
    provider: 'ethereal',
    smtpHost: '127.0.0.1',
    smtpPort: options.smtpPort,
    smtpSecure: false,
    smtpUser: `sender-${id.slice(-8)}@ethereal.test`,
    smtpPassEnc: secrets.encrypt('password'),
    hourlyLimit: options.hourlyLimit ?? null,
    minDelayMs: options.minDelayMs ?? null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(senders).values(row);
  return row;
}

export interface CampaignFixture {
  campaign: CampaignRow;
  emails: EmailRow[];
}

/**
 * Inserts a campaign and its emails directly (bypassing the planner) so tests control the
 * exact scheduled times, e.g. many emails due at the same instant.
 */
export async function createCampaign(
  db: Database,
  options: {
    user: UserRow;
    sender: SenderRow;
    recipients: string[];
    scheduledAt: Date | ((index: number) => Date);
    hourlyLimit?: number;
    delayBetweenMs?: number;
    subject?: string;
  },
): Promise<CampaignFixture> {
  const now = new Date();
  const campaignId = newId();
  const at = (index: number) =>
    typeof options.scheduledAt === 'function' ? options.scheduledAt(index) : options.scheduledAt;
  const campaign: CampaignRow = {
    id: campaignId,
    userId: options.user.id,
    senderId: options.sender.id,
    subject: options.subject ?? 'Meeting follow-up',
    bodyHtml: '<p>Hi, just following up on our meeting.</p>',
    bodyText: 'Hi, just following up on our meeting.',
    previewText: 'Hi, just following up on our meeting.',
    startAt: at(0),
    delayBetweenMs: options.delayBetweenMs ?? 0,
    hourlyLimit: options.hourlyLimit ?? 1_000,
    recipientCount: options.recipients.length,
    idempotencyKey: newId(),
    requestHash: 'f'.repeat(64),
    enqueuedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(campaigns).values(campaign);

  const rows = options.recipients.map((recipientEmail, index) => ({
    id: newId(),
    campaignId,
    userId: options.user.id,
    senderId: options.sender.id,
    recipientEmail,
    recipientName: null,
    seqNo: index,
    status: 'scheduled' as const,
    scheduledAt: at(index),
    originalScheduledAt: at(index),
    createdAt: now,
    updatedAt: now,
  }));
  await db.insert(emails).values(rows);
  const inserted = await db.select().from(emails).where(eq(emails.campaignId, campaignId));
  inserted.sort((a, b) => a.seqNo - b.seqNo);
  return { campaign, emails: inserted };
}

export function enqueueFixture(queues: Queues, fixture: CampaignFixture): Promise<void> {
  return enqueueEmailJobs(
    queues.emails,
    fixture.emails.map((email) => ({
      emailId: email.id,
      campaignId: email.campaignId,
      senderId: email.senderId,
      userId: email.userId,
      to: email.recipientEmail,
      scheduledAt: email.scheduledAt,
    })),
  );
}

export async function emailRow(db: Database, id: string): Promise<EmailRow> {
  const [row] = await db.select().from(emails).where(eq(emails.id, id));
  if (!row) throw new Error(`email ${id} not found`);
  return row;
}

export async function emailRows(db: Database, campaignId: string): Promise<EmailRow[]> {
  const rows = await db.select().from(emails).where(eq(emails.campaignId, campaignId));
  return rows.sort((a, b) => a.seqNo - b.seqNo);
}
