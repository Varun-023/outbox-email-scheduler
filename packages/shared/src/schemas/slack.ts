import { z } from 'zod';

export const slackConnectionStatusSchema = z.object({
  configured: z.boolean(),
  connected: z.boolean(),
  teamName: z.string().optional(),
  channelName: z.string().optional(),
  connectedAt: z.string().optional(),
});
export type SlackConnectionStatus = z.infer<typeof slackConnectionStatusSchema>;
