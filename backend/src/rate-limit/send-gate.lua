-- Atomic send gate: reserves one send slot for a sender and one of its campaigns.
--
-- Enforces, across every worker process:
--   * the hourly limit per sender and per campaign (fixed windows of windowMs), and
--   * the minimum gap between two sends of the same sender / the same campaign.
-- Time comes from Redis TIME, so clock differences between workers do not matter.
--
-- ARGV: senderPrefix, campaignPrefix, senderLimit, senderGapMs,
--       campaignLimit, campaignGapMs, windowMs
-- Keys are derived from the prefixes, which share the {s:<senderId>} hash tag.
--
-- Returns { decision, atMs, windowIdx, limitingScope, senderReached, campaignReached, nowMs }
--   decision "allow": the slot at atMs (now or a little later) is reserved and counted.
--   decision "defer": the window is full; atMs is an ordered position in a later window,
--                     derived from a ticket, so overflowing emails keep their relative order.

local senderPrefix = ARGV[1]
local campaignPrefix = ARGV[2]
local senderLimit = tonumber(ARGV[3])
local senderGap = tonumber(ARGV[4])
local campaignLimit = tonumber(ARGV[5])
local campaignGap = tonumber(ARGV[6])
local windowMs = tonumber(ARGV[7])

local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local idx = math.floor(now / windowMs)
local windowEnd = (idx + 1) * windowMs
local ttl = windowEnd - now + windowMs

local senderWinKey = senderPrefix .. ':win:' .. idx
local campaignWinKey = campaignPrefix .. ':win:' .. idx
local senderCount = tonumber(redis.call('GET', senderWinKey) or '0')
local campaignCount = tonumber(redis.call('GET', campaignWinKey) or '0')

local limiting = nil
if senderCount >= senderLimit then
  limiting = 'sender'
elseif campaignCount >= campaignLimit then
  limiting = 'campaign'
end

local slot = now
if not limiting then
  local senderNext = tonumber(redis.call('GET', senderPrefix .. ':next') or '0')
  local campaignNext = tonumber(redis.call('GET', campaignPrefix .. ':next') or '0')
  slot = math.max(now, senderNext, campaignNext)
  -- The queue of reserved slots spills past this window: treat it like a full window.
  if slot >= windowEnd then
    if senderNext >= campaignNext then limiting = 'sender' else limiting = 'campaign' end
  end
end

if not limiting then
  redis.call('INCR', senderWinKey)
  redis.call('PEXPIRE', senderWinKey, ttl)
  redis.call('INCR', campaignWinKey)
  redis.call('PEXPIRE', campaignWinKey, ttl)
  redis.call('SET', senderPrefix .. ':next', slot + senderGap, 'PX', ttl)
  redis.call('SET', campaignPrefix .. ':next', slot + campaignGap, 'PX', ttl)
  -- Exactly one reservation per window sees count + 1 == limit: the moment the limit is reached.
  local senderReached = 0
  if senderCount + 1 == senderLimit then senderReached = 1 end
  local campaignReached = 0
  if campaignCount + 1 == campaignLimit then campaignReached = 1 end
  return { 'allow', slot, idx, '', senderReached, campaignReached, now }
end

local limit = senderLimit
local gap = senderGap
local prefix = senderPrefix
if limiting == 'campaign' then
  limit = campaignLimit
  gap = campaignGap
  prefix = campaignPrefix
end

local deferKey = prefix .. ':defer:' .. (idx + 1)
local ticket = redis.call('INCR', deferKey) - 1
redis.call('PEXPIRE', deferKey, ttl + windowMs)
local targetWindow = idx + 1 + math.floor(ticket / limit)
local target = targetWindow * windowMs + (ticket % limit) * gap
return { 'defer', target, idx, limiting, 0, 0, now }
