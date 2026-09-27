import type { AuthUser } from '@outbox/shared';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../../lib/app-error';
import type { UsersRepository } from '../users/users.repository';
import { destroySession } from './session';

const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Sign in required');

/** Loads the session's user on every request, so a deleted user is logged out immediately. */
export function requireAuth(users: UsersRepository): RequestHandler {
  return async (req, _res, next) => {
    const userId = req.session?.userId;
    if (!userId) throw unauthenticated();

    const user = await users.findById(userId);
    if (!user) {
      await destroySession(req);
      throw unauthenticated();
    }

    req.user = { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl };
    next();
  };
}

/** Gate for operator tools such as Bull Board: the signed-in email must be allow-listed. */
export function requireAdmin(adminEmails: readonly string[]): RequestHandler {
  const allowed = new Set(adminEmails.map((email) => email.toLowerCase()));
  return (req, _res, next) => {
    const email = req.user?.email.toLowerCase();
    if (!email || !allowed.has(email)) {
      throw new AppError(403, 'FORBIDDEN', 'Admin access required');
    }
    next();
  };
}

/** The authenticated user; only call behind requireAuth. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthenticated();
  return req.user;
}
