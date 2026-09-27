import nodemailer, { type Transporter } from 'nodemailer';
import type { SenderRow } from '../db/schema';
import type { SecretBox } from '../lib/crypto';
import type { OutgoingMessage } from './build-message';

export interface SmtpSettings {
  connectionTimeoutMs: number;
  socketTimeoutMs: number;
  /** Refuse to send over plaintext when the server does not offer STARTTLS. */
  requireTls: boolean;
}

export interface SentMessage {
  messageId: string;
  response: string;
  /** Ethereal's web link for the captured message; null for other SMTP servers. */
  previewUrl: string | null;
}

interface CachedTransport {
  fingerprint: string;
  transporter: Transporter;
}

/**
 * One pooled SMTP transport per sender, created lazily. Passwords are decrypted only here,
 * in memory, and a transport is rebuilt if the sender's credentials change.
 */
export class TransportPool {
  private readonly transports = new Map<string, CachedTransport>();

  constructor(
    private readonly secrets: SecretBox,
    private readonly settings: SmtpSettings,
  ) {}

  async send(sender: SenderRow, message: OutgoingMessage): Promise<SentMessage> {
    const info = await this.transportFor(sender).sendMail(message);
    const previewUrl = nodemailer.getTestMessageUrl(info);
    return {
      messageId: String(info.messageId ?? message.messageId),
      response: String(info.response ?? ''),
      previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
    };
  }

  close(): void {
    for (const { transporter } of this.transports.values()) transporter.close();
    this.transports.clear();
  }

  private transportFor(sender: SenderRow): Transporter {
    const fingerprint = [
      sender.smtpHost,
      sender.smtpPort,
      sender.smtpSecure,
      sender.smtpUser,
      sender.smtpPassEnc,
    ].join('|');
    const cached = this.transports.get(sender.id);
    if (cached?.fingerprint === fingerprint) return cached.transporter;
    cached?.transporter.close();

    const transporter = nodemailer.createTransport({
      host: sender.smtpHost,
      port: sender.smtpPort,
      secure: sender.smtpSecure,
      requireTLS: this.settings.requireTls && !sender.smtpSecure,
      auth: { user: sender.smtpUser, pass: this.secrets.decrypt(sender.smtpPassEnc) },
      pool: true,
      maxConnections: 2,
      connectionTimeout: this.settings.connectionTimeoutMs,
      greetingTimeout: this.settings.connectionTimeoutMs,
      socketTimeout: this.settings.socketTimeoutMs,
    });
    this.transports.set(sender.id, { fingerprint, transporter });
    return transporter;
  }
}
