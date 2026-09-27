export interface OutgoingMessage {
  from: { name: string; address: string };
  to: string | { name: string; address: string };
  subject: string;
  html: string;
  text: string;
  messageId: string;
  headers: Record<string, string>;
}

export interface MessageInput {
  emailId: string;
  campaignId: string;
  fromName: string;
  fromEmail: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  bodyHtml: string;
  bodyText: string;
}

/** Stable per email, so a real provider (or a recipient's client) can recognise a duplicate. */
export function messageIdFor(emailId: string, domain: string): string {
  return `<email-${emailId}@${domain}>`;
}

export function buildMessage(input: MessageInput, messageIdDomain: string): OutgoingMessage {
  return {
    from: { name: input.fromName, address: input.fromEmail },
    to: input.recipientName
      ? { name: input.recipientName, address: input.recipientEmail }
      : input.recipientEmail,
    subject: input.subject,
    html: input.bodyHtml,
    text: input.bodyText,
    messageId: messageIdFor(input.emailId, messageIdDomain),
    headers: {
      'X-Outbox-Email-Id': input.emailId,
      'X-Outbox-Campaign-Id': input.campaignId,
    },
  };
}
