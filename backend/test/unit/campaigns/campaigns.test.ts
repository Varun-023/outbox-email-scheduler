import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/lib/app-error';
import { normalizeRecipients } from '../../../src/modules/campaigns/campaigns.service';
import { computeRequestHash } from '../../../src/modules/campaigns/idempotency';
import { planSchedule } from '../../../src/modules/campaigns/schedule-planner';

const HOUR = 3_600_000;
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe('planSchedule', () => {
  it('spaces emails by the gap within one window', () => {
    const planned = planSchedule({
      count: 3,
      startAt: new Date('2026-09-27T10:20:00.000Z'),
      hourlyLimit: 100,
      gapMs: 5_000,
      windowMs: HOUR,
    });

    expect(iso(planned)).toEqual([
      '2026-09-27T10:20:00.000Z',
      '2026-09-27T10:20:05.000Z',
      '2026-09-27T10:20:10.000Z',
    ]);
  });

  it('moves overflow to the start of the next clock window', () => {
    const planned = planSchedule({
      count: 5,
      startAt: new Date('2026-09-27T10:50:00.000Z'),
      hourlyLimit: 2,
      gapMs: 5_000,
      windowMs: HOUR,
    });

    expect(iso(planned)).toEqual([
      '2026-09-27T10:50:00.000Z',
      '2026-09-27T10:50:05.000Z',
      '2026-09-27T11:00:00.000Z',
      '2026-09-27T11:00:05.000Z',
      '2026-09-27T12:00:00.000Z',
    ]);
  });

  it('starts counting afresh when the gap crosses into a new window', () => {
    const planned = planSchedule({
      count: 4,
      startAt: new Date('2026-09-27T10:59:58.000Z'),
      hourlyLimit: 2,
      gapMs: 1_000,
      windowMs: HOUR,
    });

    expect(iso(planned)).toEqual([
      '2026-09-27T10:59:58.000Z',
      '2026-09-27T10:59:59.000Z',
      '2026-09-27T11:00:00.000Z',
      '2026-09-27T11:00:01.000Z',
    ]);
  });

  it('never exceeds the limit in any window, even for 1,000 recipients sent together', () => {
    const planned = planSchedule({
      count: 1_000,
      startAt: new Date('2026-09-27T10:00:00.000Z'),
      hourlyLimit: 200,
      gapMs: 0,
      windowMs: HOUR,
    });
    const perWindow = new Map<number, number>();
    for (const date of planned) {
      const window = Math.floor(date.getTime() / HOUR);
      perWindow.set(window, (perWindow.get(window) ?? 0) + 1);
    }

    expect([...perWindow.values()]).toEqual([200, 200, 200, 200, 200]);
    expect(planned.every((date, i) => i === 0 || date >= (planned[i - 1] as Date))).toBe(true);
  });
});

describe('normalizeRecipients', () => {
  it('normalises, keeps the first occurrence and counts duplicates', () => {
    expect(
      normalizeRecipients(
        [
          { email: 'Tame@JMail.com', name: 'Tame' },
          { email: 'lame@jmail.com' },
          { email: ' tame@jmail.com ' },
          { email: 'John <LAME@jmail.com>' },
        ],
        10,
      ),
    ).toEqual({
      accepted: [
        { email: 'tame@jmail.com', name: 'Tame' },
        { email: 'lame@jmail.com', name: null },
      ],
      duplicatesRemoved: 2,
    });
  });

  it('rejects invalid addresses with their positions, reporting at most 20', () => {
    const recipients = [
      { email: 'ok@example.com' },
      ...Array.from({ length: 25 }, (_, i) => ({ email: `bad-${i}` })),
    ];

    try {
      normalizeRecipients(recipients, 100);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const error = err as AppError;
      expect(error.message).toBe('25 recipient address(es) are invalid');
      expect(error.details).toHaveLength(20);
      expect(error.details?.[0]).toEqual({
        path: 'recipients[1].email',
        message: 'Invalid email address',
      });
    }
  });

  it('enforces the per-campaign maximum after de-duplication', () => {
    expect(() =>
      normalizeRecipients([{ email: 'a@example.com' }, { email: 'b@example.com' }], 1),
    ).toThrow('Too many recipients');
    expect(
      normalizeRecipients([{ email: 'a@example.com' }, { email: 'A@example.com' }], 1).accepted,
    ).toHaveLength(1);
  });
});

describe('computeRequestHash', () => {
  it('ignores key order and undefined fields', () => {
    expect(computeRequestHash({ a: 1, b: [1, { c: 2, d: undefined }] })).toBe(
      computeRequestHash({ b: [1, { c: 2 }], a: 1 }),
    );
  });

  it('changes when any value changes', () => {
    expect(computeRequestHash({ subject: 'Hi' })).not.toBe(computeRequestHash({ subject: 'Hi!' }));
    expect(computeRequestHash({ recipients: ['a', 'b'] })).not.toBe(
      computeRequestHash({ recipients: ['b', 'a'] }),
    );
  });
});
