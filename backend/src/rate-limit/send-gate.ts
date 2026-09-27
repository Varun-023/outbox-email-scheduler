import { readFileSync } from 'node:fs';
import type { Redis } from 'ioredis';
import { campaignGatePrefix, senderGatePrefix } from './keys';

// Loaded next to this module; tsup copies the file into dist/ for production builds.
const SEND_GATE_LUA = readFileSync(new URL('./send-gate.lua', import.meta.url), 'utf8');
const COMMAND = 'outboxSendGate';

// Reserved slots are spaced by the gap, but BullMQ can wake a delayed job late (Redis checks
// blocking timeouts on its ~100 ms timer), which would squeeze the gap to the next send.
// This check runs right before a send and compares against the previous *actual* start.
// ARGV: senderPrefix, campaignPrefix, senderGapMs, campaignGapMs, ttlMs → ms to wait, or 0.
const CONFIRM_START_LUA = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local wait = 0
local senderLast = redis.call('GET', ARGV[1] .. ':last')
if senderLast then wait = math.max(wait, tonumber(senderLast) + tonumber(ARGV[3]) - now) end
local campaignLast = redis.call('GET', ARGV[2] .. ':last')
if campaignLast then wait = math.max(wait, tonumber(campaignLast) + tonumber(ARGV[4]) - now) end
if wait > 0 then return wait end
redis.call('SET', ARGV[1] .. ':last', now, 'PX', ARGV[5])
redis.call('SET', ARGV[2] .. ':last', now, 'PX', ARGV[5])
return 0`;
const CONFIRM_COMMAND = 'outboxConfirmSendStart';

export interface GateScope {
  /** Maximum sends per window. */
  limit: number;
  /** Minimum gap between two sends in this scope. */
  gapMs: number;
}

export interface GateRequest {
  senderId: string;
  campaignId: string;
  sender: GateScope;
  campaign: GateScope;
}

export type LimitingScope = 'sender' | 'campaign';

export type GateDecision =
  | {
      kind: 'allow';
      /** How long until the reserved slot (0 = send now), measured on the Redis clock. */
      waitMs: number;
      windowIdx: number;
      senderReached: boolean;
      campaignReached: boolean;
    }
  | {
      kind: 'defer';
      /** Delay until the email's ordered position in a later window. */
      delayMs: number;
      windowIdx: number;
      scope: LimitingScope;
    };

type GateReply = [string, number, number, string, number, number, number];

interface GateCommands {
  [COMMAND](...args: (string | number)[]): Promise<GateReply>;
  [CONFIRM_COMMAND](...args: (string | number)[]): Promise<number>;
}

/** Atomic per-sender + per-campaign rate limiter backed by one Redis Lua script. */
export class SendGate {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
    private readonly windowMs: number,
  ) {
    if (!(COMMAND in redis)) {
      redis.defineCommand(COMMAND, { numberOfKeys: 0, lua: SEND_GATE_LUA });
      redis.defineCommand(CONFIRM_COMMAND, { numberOfKeys: 0, lua: CONFIRM_START_LUA });
    }
  }

  /**
   * Called right before sending. Returns 0 (and records this start) when at least the gap
   * has passed since the previous send of the sender and of the campaign, else the ms to wait.
   */
  async confirmStart(
    request: Omit<GateRequest, 'sender' | 'campaign'> & {
      senderGapMs: number;
      campaignGapMs: number;
    },
  ): Promise<number> {
    if (request.senderGapMs <= 0 && request.campaignGapMs <= 0) return 0;
    const ttlMs = Math.max(request.senderGapMs, request.campaignGapMs, 1_000) + 1_000;
    const wait = await (this.redis as unknown as GateCommands)[CONFIRM_COMMAND](
      senderGatePrefix(this.keyPrefix, request.senderId),
      campaignGatePrefix(this.keyPrefix, request.senderId, request.campaignId),
      request.senderGapMs,
      request.campaignGapMs,
      ttlMs,
    );
    return Math.max(0, wait);
  }

  async reserve(request: GateRequest): Promise<GateDecision> {
    const reply = await (this.redis as unknown as GateCommands)[COMMAND](
      senderGatePrefix(this.keyPrefix, request.senderId),
      campaignGatePrefix(this.keyPrefix, request.senderId, request.campaignId),
      request.sender.limit,
      request.sender.gapMs,
      request.campaign.limit,
      request.campaign.gapMs,
      this.windowMs,
    );
    const [decision, atMs, windowIdx, scope, senderReached, campaignReached, redisNow] = reply;

    if (decision === 'allow') {
      return {
        kind: 'allow',
        waitMs: Math.max(0, atMs - redisNow),
        windowIdx,
        senderReached: senderReached === 1,
        campaignReached: campaignReached === 1,
      };
    }
    return {
      kind: 'defer',
      delayMs: Math.max(0, atMs - redisNow),
      windowIdx,
      scope: scope === 'campaign' ? 'campaign' : 'sender',
    };
  }
}
