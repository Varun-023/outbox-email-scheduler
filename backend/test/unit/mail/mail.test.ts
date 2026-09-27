import { describe, expect, it } from 'vitest';
import { buildMessage, messageIdFor } from '../../../src/mail/build-message';
import { classifySmtpError } from '../../../src/mail/classify-smtp-error';

const smtpError = (fields: { code?: string; responseCode?: number; message?: string }) =>
  Object.assign(new Error(fields.message ?? 'SMTP error'), fields);

describe('classifySmtpError', () => {
  it.each([
    [{ code: 'EENVELOPE', responseCode: 550, message: 'Mailbox unavailable' }, 'permanent'],
    [{ code: 'EMESSAGE', responseCode: 554, message: 'Rejected' }, 'permanent'],
    [{ code: 'EENVELOPE', message: 'No recipients defined' }, 'permanent'],
    [{ code: 'EENVELOPE', responseCode: 451, message: 'Try again later' }, 'transient'],
    [{ code: 'EMESSAGE', responseCode: 421, message: 'Service not available' }, 'transient'],
    [{ code: 'EAUTH', responseCode: 454, message: 'Temporary auth failure' }, 'transient'],
    [{ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.example' }, 'transient'],
    [{ code: 'ECONNECTION', message: 'connect ECONNREFUSED 127.0.0.1:587' }, 'transient'],
    [{ code: 'ETIMEDOUT', message: 'Connection timeout' }, 'transient'],
    [{ code: 'ETIMEDOUT', message: 'Greeting never received' }, 'transient'],
  ] as const)('%j is %s', (fields, kind) => {
    expect(classifySmtpError(smtpError(fields))).toBe(kind);
  });

  it.each([
    { code: 'ETIMEDOUT', message: 'Timeout' },
    { code: 'ESOCKET', message: 'read ECONNRESET' },
    { code: 'ECONNECTION', message: 'Connection closed unexpectedly' },
  ])(
    'treats a mid-session drop (%j) as uncertain: the message may have been accepted',
    (fields) => {
      expect(classifySmtpError(smtpError(fields))).toBe('uncertain');
    },
  );

  it('treats unknown errors as transient', () => {
    expect(classifySmtpError(new Error('boom'))).toBe('transient');
    expect(classifySmtpError(undefined)).toBe('transient');
  });
});

describe('buildMessage', () => {
  it('uses a stable Message-ID and tracing headers', () => {
    const message = buildMessage(
      {
        emailId: '0192f0c4-7f00-7000-8000-000000000001',
        campaignId: '0192f0c4-7f00-7000-8000-000000000002',
        fromName: 'Oliver Brown',
        fromEmail: 'oliver@ethereal.email',
        recipientEmail: 'john@example.com',
        recipientName: 'John Smith',
        subject: 'Meeting follow-up',
        bodyHtml: '<p>Hi</p>',
        bodyText: 'Hi',
      },
      'outbox.local',
    );

    expect(message).toEqual({
      from: { name: 'Oliver Brown', address: 'oliver@ethereal.email' },
      to: { name: 'John Smith', address: 'john@example.com' },
      subject: 'Meeting follow-up',
      html: '<p>Hi</p>',
      text: 'Hi',
      messageId: '<email-0192f0c4-7f00-7000-8000-000000000001@outbox.local>',
      headers: {
        'X-Outbox-Email-Id': '0192f0c4-7f00-7000-8000-000000000001',
        'X-Outbox-Campaign-Id': '0192f0c4-7f00-7000-8000-000000000002',
      },
    });
    expect(messageIdFor('abc', 'outbox.local')).toBe('<email-abc@outbox.local>');
  });
});
