import { describe, expect, it } from 'vitest';
import { createCampaignRequestSchema, idempotencyKeySchema, listEmailsQuerySchema } from '../src';

const validRequest = {
  senderId: '0192f0c4-7f00-7000-8000-000000000001',
  subject: 'Meeting follow-up',
  bodyHtml: '<p>Hi there</p>',
  recipients: [{ email: 'tame@jmail.com' }],
};

describe('createCampaignRequestSchema', () => {
  it('accepts a minimal request', () => {
    expect(createCampaignRequestSchema.parse(validRequest)).toEqual(validRequest);
  });

  it('collapses line breaks in the subject to prevent header injection', () => {
    const parsed = createCampaignRequestSchema.parse({
      ...validRequest,
      subject: 'Hello\r\nBcc: victim@example.com',
    });

    expect(parsed.subject).toBe('Hello Bcc: victim@example.com');
  });

  it('rejects unknown fields, blank subjects and out-of-range numbers', () => {
    const result = createCampaignRequestSchema.safeParse({
      ...validRequest,
      subject: ' \n ',
      delayBetweenEmailsSeconds: 3601,
      hourlyLimit: 0,
      extra: true,
    });

    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((issue) => issue.path.join('.'));
    expect(paths).toEqual(
      expect.arrayContaining(['subject', 'delayBetweenEmailsSeconds', 'hourlyLimit', '']),
    );
  });

  it('requires an ISO timestamp with an offset for startAt', () => {
    expect(
      createCampaignRequestSchema.safeParse({ ...validRequest, startAt: '2026-09-27T10:00:00Z' })
        .success,
    ).toBe(true);
    expect(
      createCampaignRequestSchema.safeParse({ ...validRequest, startAt: 'tomorrow' }).success,
    ).toBe(false);
  });

  it('rejects bodies over 256 KB', () => {
    const result = createCampaignRequestSchema.safeParse({
      ...validRequest,
      bodyHtml: 'x'.repeat(256 * 1024 + 1),
    });

    expect(result.success).toBe(false);
  });
});

describe('idempotencyKeySchema', () => {
  it.each(['0192f0c4-7f00-7000-8000-000000000001', 'k', 'a'.repeat(64)])('accepts %s', (key) => {
    expect(idempotencyKeySchema.safeParse(key).success).toBe(true);
  });

  it.each([undefined, '', 'has space', 'a'.repeat(65), 'naïve'])('rejects %j', (key) => {
    expect(idempotencyKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('listEmailsQuerySchema', () => {
  it('parses query-string values', () => {
    expect(listEmailsQuerySchema.parse({ folder: 'sent', status: 'failed', limit: '10' })).toEqual({
      folder: 'sent',
      status: 'failed',
      limit: 10,
    });
    expect(listEmailsQuerySchema.parse({ folder: 'scheduled', rescheduled: 'true' })).toEqual({
      folder: 'scheduled',
      rescheduled: true,
      limit: 25,
    });
  });

  it('rejects a status that belongs to the other folder', () => {
    const result = listEmailsQuerySchema.safeParse({ folder: 'scheduled', status: 'sent' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['status']);
  });
});
