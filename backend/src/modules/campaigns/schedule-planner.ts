export interface ScheduleParams {
  count: number;
  startAt: Date;
  /** Emails allowed per window (the effective campaign limit). */
  hourlyLimit: number;
  /** Minimum gap between two consecutive emails. */
  gapMs: number;
  /** Window length; clock-aligned to match the send gate's windows. */
  windowMs: number;
}

/**
 * Assigns each email a planned send time: consecutive emails are `gapMs` apart and each
 * clock window holds at most `hourlyLimit`; overflow starts at the next window. The worker's
 * send gate stays the authority at send time; this plan spreads jobs out so they do not all
 * wake up at once and gives the dashboard realistic times.
 */
export function planSchedule({
  count,
  startAt,
  hourlyLimit,
  gapMs,
  windowMs,
}: ScheduleParams): Date[] {
  const planned: Date[] = [];
  let time = startAt.getTime();
  let window = Math.floor(time / windowMs);
  let inWindow = 0;

  for (let index = 0; index < count; index += 1) {
    if (inWindow >= hourlyLimit) {
      window += 1;
      time = window * windowMs;
      inWindow = 0;
    }
    planned.push(new Date(time));
    inWindow += 1;

    time += gapMs;
    const next = Math.floor(time / windowMs);
    if (next !== window) {
      window = next;
      inWindow = 0;
    }
  }
  return planned;
}
