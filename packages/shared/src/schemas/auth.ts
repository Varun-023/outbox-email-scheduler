import { z } from 'zod';

export const authUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  avatarUrl: z.string().nullable(),
});
export type AuthUser = z.infer<typeof authUserSchema>;

export const meResponseSchema = z.object({ user: authUserSchema });
export type MeResponse = z.infer<typeof meResponseSchema>;
