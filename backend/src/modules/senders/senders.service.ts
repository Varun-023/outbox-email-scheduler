import type { AuthUser, Sender } from '@outbox/shared';
import type { Redis } from 'ioredis';
import type { SenderRow } from '../../db/schema';
import { AppError } from '../../lib/app-error';
import type { SecretBox } from '../../lib/crypto';
import { newId } from '../../lib/ids';
import { tryAcquireLock } from '../../lib/redis-lock';
import type { EtherealAccountProvider } from './ethereal';
import type { NewSenderRow, SendersRepository } from './senders.repository';

const PROVISION_LOCK_TTL_MS = 60_000;
const PROVISION_WAIT_ATTEMPTS = 40;
const PROVISION_WAIT_MS = 250;

export interface SenderDefaults {
  hourlyLimit: number;
  minDelayMs: number;
}

export interface SendersServiceDeps {
  repository: SendersRepository;
  ethereal: EtherealAccountProvider;
  secrets: SecretBox;
  redis: Redis;
  keyPrefix: string;
  autoProvisionCount: number;
  defaults: SenderDefaults;
}

/** Effective throttling for a sender: its own override, else the environment default. */
export function effectiveSenderLimits(row: SenderRow, defaults: SenderDefaults): SenderDefaults {
  return {
    hourlyLimit: row.hourlyLimit ?? defaults.hourlyLimit,
    minDelayMs: row.minDelayMs ?? defaults.minDelayMs,
  };
}

export class SendersService {
  constructor(private readonly deps: SendersServiceDeps) {}

  /** Lists the user's senders, creating Ethereal senders on first use when they have none. */
  async listForUser(user: AuthUser): Promise<Sender[]> {
    let rows = await this.deps.repository.listActiveByUser(user.id);
    if (rows.length === 0 && this.deps.autoProvisionCount > 0) {
      rows = await this.provisionDefaults(user);
    }
    return rows.map((row) => this.toDto(row));
  }

  async requireOwned(userId: string, senderId: string): Promise<SenderRow> {
    const row = await this.deps.repository.findActiveOwned(senderId, userId);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Sender not found');
    return row;
  }

  limitsFor(row: SenderRow): SenderDefaults {
    return effectiveSenderLimits(row, this.deps.defaults);
  }

  /**
   * One request per user creates the accounts while holding a Redis lock; concurrent
   * requests wait for it and then read the result, so a user never gets duplicate senders.
   */
  private async provisionDefaults(user: AuthUser): Promise<SenderRow[]> {
    const { repository, redis, keyPrefix } = this.deps;
    const lockKey = `${keyPrefix}:lock:provision:${user.id}`;

    for (let attempt = 0; attempt < PROVISION_WAIT_ATTEMPTS; attempt += 1) {
      const lock = await tryAcquireLock(redis, lockKey, PROVISION_LOCK_TTL_MS);
      if (lock) {
        try {
          const existing = await repository.listActiveByUser(user.id);
          if (existing.length > 0) return existing;
          await repository.insertMany(await this.createEtherealSenders(user));
          return await repository.listActiveByUser(user.id);
        } finally {
          await lock.release();
        }
      }

      await new Promise((resolve) => setTimeout(resolve, PROVISION_WAIT_MS));
      const rows = await repository.listActiveByUser(user.id);
      if (rows.length > 0) return rows;
    }

    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Sender setup is still in progress; try again');
  }

  private async createEtherealSenders(user: AuthUser): Promise<NewSenderRow[]> {
    const now = new Date();
    const rows: NewSenderRow[] = [];
    try {
      for (let index = 0; index < this.deps.autoProvisionCount; index += 1) {
        const account = await this.deps.ethereal.createAccount();
        rows.push({
          id: newId(),
          userId: user.id,
          label: `Ethereal sender ${index + 1}`,
          fromName: user.name,
          fromEmail: account.user.toLowerCase(),
          provider: 'ethereal',
          smtpHost: account.smtp.host,
          smtpPort: account.smtp.port,
          smtpSecure: account.smtp.secure,
          smtpUser: account.user,
          smtpPassEnc: this.deps.secrets.encrypt(account.pass),
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (err) {
      throw new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'Could not create Ethereal sender accounts; try again shortly',
        undefined,
        { cause: err },
      );
    }
    return rows;
  }

  private toDto(row: SenderRow): Sender {
    const limits = this.limitsFor(row);
    return {
      id: row.id,
      label: row.label,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      provider: row.provider,
      hourlyLimit: limits.hourlyLimit,
      minDelayMs: limits.minDelayMs,
    };
  }
}
