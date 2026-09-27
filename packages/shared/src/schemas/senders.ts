import { z } from 'zod';

export const senderSchema = z.object({
  id: z.string(),
  label: z.string(),
  fromName: z.string(),
  fromEmail: z.string(),
  provider: z.literal('ethereal'),
  /** Effective hourly limit (the sender override or the server default). */
  hourlyLimit: z.number().int(),
  /** Effective minimum gap between two sends from this sender. */
  minDelayMs: z.number().int(),
});
export type Sender = z.infer<typeof senderSchema>;

export const listSendersResponseSchema = z.object({ items: z.array(senderSchema) });
export type ListSendersResponse = z.infer<typeof listSendersResponseSchema>;
