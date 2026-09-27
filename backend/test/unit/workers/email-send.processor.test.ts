import { DelayedError } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { CampaignRow, EmailRow, SenderRow } from '../../../src/db/schema';
import type { SendEmailJobData } from '../../../src/queue/queues';
import {
  createEmailSendProcessor,
  type EmailSendDeps,
} from '../../../src/workers/email-send.processor';

const NOW = Date.now();

function row(status: EmailRow['status'] = 'scheduled') {
  return {
    email: {
      id: 'email-1',
      campaignId: 'campaign-1',
      userId: 'user-1',
      senderId: 'sender-1',
      status,
      scheduledAt: new Date(NOW - 1_000),
      recipientEmail: 'john@example.com',
      recipientName: null,
      leaseUntil: null,
    } as unknown as EmailRow,
    campaign: {
      id: 'campaign-1',
      subject: 'Hi',
      bodyHtml: '<p>Hi</p>',
      bodyText: 'Hi',
      hourlyLimit: 10,
      delayBetweenMs: 0,
    } as unknown as CampaignRow,
    sender: {
      id: 'sender-1',
      fromName: 'Oliver',
      fromEmail: 'oliver@ethereal.test',
      hourlyLimit: 50,
      minDelayMs: null,
    } as unknown as SenderRow,
  };
}

function fakeJob(data: Partial<SendEmailJobData> = {}) {
  const job = {
    data: {
      emailId: 'email-1',
      campaignId: 'campaign-1',
      senderId: 'sender-1',
      userId: 'user-1',
      to: 'john@example.com',
      ...data,
    } as SendEmailJobData,
    opts: { attempts: 3 },
    attemptsMade: 0,
    updateData: vi.fn(async (next: SendEmailJobData) => {
      job.data = next;
    }),
    moveToDelayed: vi.fn(async () => {}),
  };
  return job;
}

function setup(overrides: Partial<Record<string, unknown>> = {}) {
  const emails = {
    findForSending: vi.fn(async () => row()),
    claim: vi.fn(async () => true),
    defer: vi.fn(async () => true),
    markSent: vi.fn(async () => true),
    ...(overrides.emails as object),
  };
  const deps = {
    emails,
    gate: {
      reserve: vi.fn(async () => ({
        kind: 'allow',
        waitMs: 0,
        windowIdx: 7,
        senderReached: false,
        campaignReached: false,
      })),
      confirmStart: vi.fn(async () => 0),
      ...(overrides.gate as object),
    },
    receipts: { save: vi.fn(async () => {}), get: vi.fn(async () => null) },
    transports: {
      send: vi.fn(async () => ({ messageId: '<m@x>', response: '250 OK', previewUrl: null })),
    },
    notifications: { add: vi.fn(async () => ({})) },
    config: {
      windowMs: 3_600_000,
      senderDefaults: { hourlyLimit: 200, minDelayMs: 0 },
      leaseMs: 90_000,
      messageIdDomain: 'outbox.local',
      uncertainPolicy: 'fail',
    },
    logger: pino({ level: 'silent' }),
    fault: () => {},
  };
  const process = createEmailSendProcessor(deps as unknown as EmailSendDeps);
  return { deps, process };
}

describe('email send processor', () => {
  it('backs off without consuming an attempt while MySQL is unavailable', async () => {
    const lost = Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST' });
    const { process } = setup({ emails: { findForSending: vi.fn().mockRejectedValue(lost) } });
    const job = fakeJob();

    await expect(process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);
    await expect(process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);

    expect(job.data.infraRetries).toBe(2);
    const [[firstAt], [secondAt]] = job.moveToDelayed.mock.calls as unknown as [[number], [number]];
    expect(firstAt - Date.now()).toBeGreaterThan(1_500); // ~2 s, then ~4 s
    expect(secondAt - Date.now()).toBeGreaterThan(3_500);
    expect(job.attemptsMade).toBe(0);
  });

  it('reschedules into a later window instead of failing when the hour is full', async () => {
    const { deps, process } = setup({
      gate: {
        reserve: vi.fn(async () => ({
          kind: 'defer',
          delayMs: 5_000,
          windowIdx: 7,
          scope: 'sender',
        })),
      },
    });
    const job = fakeJob();

    await expect(process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);

    const [[emailId, until, reason]] = deps.emails.defer.mock.calls as unknown as [
      [string, Date, string],
    ];
    expect(emailId).toBe('email-1');
    expect(reason).toBe('sender_hourly_limit');
    expect(until.getTime() - Date.now()).toBeGreaterThan(4_500);
    expect(deps.emails.claim).not.toHaveBeenCalled();
    expect(deps.transports.send).not.toHaveBeenCalled();
  });

  it('holds a reserved slot and sends on wake-up without asking the gate again', async () => {
    const { deps, process } = setup({
      gate: {
        reserve: vi.fn(async () => ({
          kind: 'allow',
          waitMs: 400,
          windowIdx: Math.floor(Date.now() / 3_600_000),
          senderReached: false,
          campaignReached: false,
        })),
      },
    });
    const job = fakeJob();

    await expect(process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);
    const reservation = job.data.reservation as { slotAt: number };
    expect(reservation.slotAt - Date.now()).toBeGreaterThan(300);

    reservation.slotAt = Date.now(); // pretend BullMQ woke the job at the slot
    await expect(process(job as never, 'token')).resolves.toEqual({
      outcome: 'sent',
      messageId: '<m@x>',
    });
    expect(deps.gate.reserve).toHaveBeenCalledTimes(1);
    expect(deps.transports.send).toHaveBeenCalledTimes(1);
  });

  it('enqueues one de-duplicated notification per scope when a limit is reached', async () => {
    const { deps, process } = setup({
      gate: {
        reserve: vi.fn(async () => ({
          kind: 'allow',
          waitMs: 0,
          windowIdx: 42,
          senderReached: true,
          campaignReached: true,
        })),
      },
    });

    await process(fakeJob() as never, 'token');

    expect(deps.notifications.add.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      { jobId: 'rl-sender-sender-1-42' },
      { jobId: 'rl-campaign-campaign-1-42' },
    ]);
    expect((deps.notifications.add.mock.calls[0] as unknown[])[1]).toMatchObject({
      userId: 'user-1',
      scope: 'sender',
      limit: 50,
      resumesAt: new Date(43 * 3_600_000).toISOString(),
    });
  });

  it.each(['sent', 'failed'] as const)(
    'does nothing for an email that is already %s',
    async (status) => {
      const { deps, process } = setup({
        emails: { findForSending: vi.fn(async () => row(status)) },
      });

      await expect(process(fakeJob() as never, 'token')).resolves.toEqual({
        outcome: 'skipped',
        reason: 'already-final',
      });
      expect(deps.gate.reserve).not.toHaveBeenCalled();
      expect(deps.transports.send).not.toHaveBeenCalled();
    },
  );

  it('waits for the gap after the previous actual send, even inside a reserved slot', async () => {
    const { deps, process } = setup({
      gate: {
        reserve: vi.fn(async () => ({
          kind: 'allow',
          waitMs: 0,
          windowIdx: Math.floor(Date.now() / 3_600_000),
          senderReached: false,
          campaignReached: false,
        })),
        confirmStart: vi.fn().mockResolvedValueOnce(400).mockResolvedValue(0),
      },
    });
    const job = fakeJob();

    // An earlier send started late, so this one must wait 400 ms more: re-delayed, not sent.
    await expect(process(job as never, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(deps.transports.send).not.toHaveBeenCalled();
    const reservation = job.data.reservation as { slotAt: number; windowIdx: number };
    expect(reservation.slotAt - Date.now()).toBeGreaterThan(300);

    // Woken at the new time with the same (already counted) slot: no second reservation.
    reservation.slotAt = Date.now();
    await expect(process(job as never, 'token')).resolves.toMatchObject({ outcome: 'sent' });
    expect(deps.gate.reserve).toHaveBeenCalledTimes(1);
  });

  it('writes the receipt before updating MySQL', async () => {
    const order: string[] = [];
    const { deps, process } = setup({
      emails: {
        markSent: vi.fn(async () => {
          order.push('mysql');
          return true;
        }),
      },
    });
    deps.receipts.save = vi.fn(async () => {
      order.push('receipt');
    });

    await process(fakeJob() as never, 'token');

    expect(order).toEqual(['receipt', 'mysql']);
  });
});
