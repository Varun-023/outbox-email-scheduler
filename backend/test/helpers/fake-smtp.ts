import { SMTPServer, type SMTPServerAddress } from 'smtp-server';

export interface ReceivedMessage {
  from: string;
  to: string[];
  messageId: string | undefined;
  subject: string | undefined;
  raw: string;
  /**
   * When the worker started this send: the connection time for a connection's first message
   * (connect, EHLO and AUTH belong to that send), otherwise MAIL FROM on the reused connection.
   */
  startedAt: number;
  /** MAIL FROM time, and the connection time when this was the connection's first message. */
  mailFromAt: number;
  connectedAt: number | undefined;
}

export interface SmtpReply {
  code: number;
  message: string;
}

/** Decides how to answer RCPT TO for an address on its Nth attempt; null accepts. */
export type RecipientRule = (attempt: number) => SmtpReply | null;

/**
 * In-process SMTP server for tests: records every accepted message and can reject chosen
 * recipients with 4xx/5xx replies. Deterministic, unlike a real provider.
 */
function timing(start: { mailFromAt: number; connectedAt?: number } | undefined) {
  const mailFromAt = start?.mailFromAt ?? Date.now();
  return {
    mailFromAt,
    connectedAt: start?.connectedAt,
    startedAt: start?.connectedAt ?? mailFromAt,
  };
}

export class FakeSmtpServer {
  readonly messages: ReceivedMessage[] = [];
  private readonly rules = new Map<string, RecipientRule>();
  private readonly attempts = new Map<string, number>();

  private constructor(
    private readonly server: SMTPServer,
    readonly port: number,
  ) {}

  static async start(): Promise<FakeSmtpServer> {
    const transactionStart = new WeakMap<object, { mailFromAt: number; connectedAt?: number }>();
    const connectedAt = new WeakMap<object, number>();
    const ref: { instance?: FakeSmtpServer } = {};

    const server = new SMTPServer({
      authOptional: true,
      allowInsecureAuth: true,
      disabledCommands: ['STARTTLS'],
      logger: false,
      closeTimeout: 100,
      onConnect(session, callback) {
        connectedAt.set(session, Date.now());
        callback();
      },
      onAuth(auth, _session, callback) {
        callback(null, { user: auth.username });
      },
      onMailFrom(_address, session, callback) {
        // smtp-server keeps one session object per connection across transactions.
        const opened = connectedAt.get(session);
        connectedAt.delete(session);
        transactionStart.set(session, { mailFromAt: Date.now(), connectedAt: opened });
        callback();
      },
      onRcptTo(address: SMTPServerAddress, _session, callback) {
        const reply = ref.instance?.replyFor(address.address.toLowerCase());
        if (!reply) return callback();
        const error = new Error(reply.message) as Error & { responseCode: number };
        error.responseCode = reply.code;
        return callback(error);
      },
      onData(stream, session, callback) {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          ref.instance?.messages.push({
            from: session.envelope.mailFrom ? session.envelope.mailFrom.address : '',
            to: session.envelope.rcptTo.map((rcpt) => rcpt.address.toLowerCase()),
            messageId: /^Message-ID:\s*(<[^>]+>)/im.exec(raw)?.[1],
            subject: /^Subject:\s*(.+)$/im.exec(raw)?.[1]?.trim(),
            raw,
            ...timing(transactionStart.get(session)),
          });
          callback();
        });
      },
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.server.address();
        resolve(typeof address === 'object' && address ? address.port : 0);
      });
    });
    ref.instance = new FakeSmtpServer(server, port);
    return ref.instance;
  }

  /** e.g. `onRecipient(email, (n) => (n < 3 ? { code: 451, message: 'Try later' } : null))`. */
  onRecipient(email: string, rule: RecipientRule): void {
    this.rules.set(email.toLowerCase(), rule);
  }

  messagesTo(email: string): ReceivedMessage[] {
    return this.messages.filter((message) => message.to.includes(email.toLowerCase()));
  }

  attemptsFor(email: string): number {
    return this.attempts.get(email.toLowerCase()) ?? 0;
  }

  reset(): void {
    this.messages.length = 0;
    this.rules.clear();
    this.attempts.clear();
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private replyFor(email: string): SmtpReply | null {
    const attempt = (this.attempts.get(email) ?? 0) + 1;
    this.attempts.set(email, attempt);
    return this.rules.get(email)?.(attempt) ?? null;
  }
}
