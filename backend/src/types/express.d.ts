import type { AuthUser } from '@outbox/shared';

declare global {
  namespace Express {
    interface Request {
      /** Set by requireAuth for authenticated routes. */
      user?: AuthUser;
    }
  }
}

export {};
