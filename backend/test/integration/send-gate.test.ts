import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/lib/ids';
import { SendGate, type GateDecision } from '../../src/rate-limit/send-gate';
import { alignToWindowStart, createTestContext, redisClockOffset } from '../helpers/context';

const WINDOW_MS = 4_000;
const ctx = createTestContext();

beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

function reserveMany(gate: SendGate, count: number, request: Parameters<SendGate['reserve']>[0]) {
  return Promise.all(Array.from({ length: count }, () => gate.reserve(request)));
}

const allowed = (decisions: GateDecision[]) => decisions.filter((d) => d.kind === 'allow');
const deferred = (decisions: GateDecision[]) =>
  decisions.filter((d): d is Extract<GateDecision, { kind: 'defer' }> => d.kind === 'defer');

describe('send gate (Redis Lua)', () => {
  it('never allows more than the hourly limit, even from many connections at once', async () => {
    await alignToWindowStart(WINDOW_MS, 1_000, ctx.redis);
    // Separate connections mimic separate worker processes racing for the same sender.
    const connections = Array.from({ length: 5 }, () => new Redis(ctx.env.REDIS_URL));
    const gates = connections.map((redis) => new SendGate(redis, 'test', WINDOW_MS));
    const request = {
      senderId: newId(),
      campaignId: newId(),
      sender: { limit: 7, gapMs: 0 },
      campaign: { limit: 100, gapMs: 0 },
    };

    const decisions = (
      await Promise.all(gates.map((gate) => reserveMany(gate, 10, request)))
    ).flat();
    await Promise.all(connections.map((redis) => redis.quit()));

    expect(allowed(decisions)).toHaveLength(7);
    expect(deferred(decisions)).toHaveLength(43);
    expect(new Set(deferred(decisions).map((d) => d.scope))).toEqual(new Set(['sender']));
  });

  it('reports the moment the limit is reached exactly once per window and scope', async () => {
    await alignToWindowStart(WINDOW_MS, 1_000, ctx.redis);
    const gate = new SendGate(ctx.redis, 'test', WINDOW_MS);
    const request = {
      senderId: newId(),
      campaignId: newId(),
      sender: { limit: 3, gapMs: 0 },
      campaign: { limit: 2, gapMs: 0 },
    };

    const decisions = await reserveMany(gate, 6, request);
    const allowedDecisions = allowed(decisions) as Extract<GateDecision, { kind: 'allow' }>[];

    expect(allowedDecisions).toHaveLength(2); // the campaign limit (2) binds first
    expect(allowedDecisions.filter((d) => d.campaignReached)).toHaveLength(1);
    expect(allowedDecisions.filter((d) => d.senderReached)).toHaveLength(0);
    expect(deferred(decisions).every((d) => d.scope === 'campaign')).toBe(true);
  });

  it('spaces reserved slots by the larger of the sender and campaign gaps', async () => {
    await alignToWindowStart(WINDOW_MS, 200, ctx.redis);
    const gate = new SendGate(ctx.redis, 'test', WINDOW_MS);
    const request = {
      senderId: newId(),
      campaignId: newId(),
      sender: { limit: 100, gapMs: 100 },
      campaign: { limit: 100, gapMs: 250 },
    };

    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const decision = await gate.reserve(request);
      if (decision.kind === 'allow') waits.push(decision.waitMs);
    }

    expect(waits).toHaveLength(4);
    for (let i = 1; i < waits.length; i += 1) {
      // Each reservation is 250 ms after the previous one, minus the time spent between calls.
      expect((waits[i] as number) - (waits[i - 1] as number)).toBeGreaterThan(150);
      expect((waits[i] as number) - (waits[i - 1] as number)).toBeLessThanOrEqual(250);
    }
  });

  it('gives overflow ordered, gap-spaced slots in the following windows', async () => {
    await alignToWindowStart(WINDOW_MS, 1_000, ctx.redis);
    const gate = new SendGate(ctx.redis, 'test', WINDOW_MS);
    const request = {
      senderId: newId(),
      campaignId: newId(),
      sender: { limit: 2, gapMs: 10 },
      campaign: { limit: 100, gapMs: 0 },
    };
    const offset = await redisClockOffset(ctx.redis);
    const windowStart = (index: number) =>
      (Math.floor((Date.now() + offset) / WINDOW_MS) + index) * WINDOW_MS;

    const decisions: GateDecision[] = [];
    const targets: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const decision = await gate.reserve(request);
      decisions.push(decision);
      // delayMs is relative to the moment of the call, so resolve it right away.
      if (decision.kind === 'defer') targets.push(Date.now() + offset + decision.delayMs);
    }

    expect(allowed(decisions)).toHaveLength(2);
    // Tickets 0..4 → next window slots 0,1, the window after slots 0,1, then the third window.
    const expected = [
      windowStart(1),
      windowStart(1) + 10,
      windowStart(2),
      windowStart(2) + 10,
      windowStart(3),
    ];
    expect(targets).toHaveLength(5);
    targets.forEach((target, i) =>
      expect(Math.abs(target - (expected[i] as number))).toBeLessThan(150),
    );
  });

  it('confirms a send only after the gap since the previous actual start', async () => {
    const gate = new SendGate(ctx.redis, 'test', WINDOW_MS);
    const request = {
      senderId: newId(),
      campaignId: newId(),
      senderGapMs: 300,
      campaignGapMs: 100,
    };

    const first = await gate.confirmStart(request);
    const tooSoon = await gate.confirmStart(request);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const later = await gate.confirmStart(request);

    expect(first).toBe(0);
    expect(tooSoon).toBeGreaterThan(250); // the larger (sender) gap applies
    expect(tooSoon).toBeLessThanOrEqual(300);
    expect(later).toBe(0);
    expect(await gate.confirmStart({ ...request, senderGapMs: 0, campaignGapMs: 0 })).toBe(0);
  });

  it('keeps senders independent of each other', async () => {
    await alignToWindowStart(WINDOW_MS, 1_000, ctx.redis);
    const gate = new SendGate(ctx.redis, 'test', WINDOW_MS);
    const limits = { sender: { limit: 1, gapMs: 0 }, campaign: { limit: 10, gapMs: 0 } };

    const first = await gate.reserve({ senderId: newId(), campaignId: newId(), ...limits });
    const second = await gate.reserve({ senderId: newId(), campaignId: newId(), ...limits });

    expect([first.kind, second.kind]).toEqual(['allow', 'allow']);
  });
});
