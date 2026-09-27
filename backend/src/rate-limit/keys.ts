/**
 * Send-gate keys. The `{s:<senderId>}` hash tag keeps every key one gate call touches in the
 * same Redis Cluster slot. The Lua script appends `:next`, `:win:<idx>` and `:defer:<idx>`.
 */
export function senderGatePrefix(keyPrefix: string, senderId: string): string {
  return `${keyPrefix}:gate:{s:${senderId}}`;
}

export function campaignGatePrefix(
  keyPrefix: string,
  senderId: string,
  campaignId: string,
): string {
  return `${senderGatePrefix(keyPrefix, senderId)}:c:${campaignId}`;
}

/** Fixed clock windows: with the default 3,600,000 ms these are UTC hours. */
export function windowIndex(epochMs: number, windowMs: number): number {
  return Math.floor(epochMs / windowMs);
}
