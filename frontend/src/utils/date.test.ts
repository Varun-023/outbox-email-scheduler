import { describe, expect, it } from 'vitest';
import { formatEmailDetailDate, formatScheduledTime, toDateTimeLocalString } from './date';

describe('date utils', () => {
  it('formats scheduled time with weekday and time', () => {
    const iso = '2026-10-15T09:15:00.000Z';
    const formatted = formatScheduledTime(iso);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe('string');
  });

  it('formats email detail date with month, day, and time', () => {
    const iso = '2026-11-03T10:23:00.000Z';
    const formatted = formatEmailDetailDate(iso);
    expect(formatted).toBeTruthy();
    expect(typeof formatted).toBe('string');
  });

  it('converts date to datetime-local formatted string', () => {
    const date = new Date(2026, 8, 28, 14, 30);
    const local = toDateTimeLocalString(date);
    expect(local).toBe('2026-09-28T14:30');
  });
});
