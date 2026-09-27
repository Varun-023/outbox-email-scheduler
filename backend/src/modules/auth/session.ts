import RedisStore from 'connect-redis';
import type { Request, RequestHandler } from 'express';
import session from 'express-session';
import type { Redis } from 'ioredis';

export interface PendingLogin {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    oauth?: PendingLogin;
  }
}

export const SESSION_COOKIE_NAME = 'outbox.sid';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Attributes a Set-Cookie must repeat to overwrite or clear the session cookie. */
export const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
};

export function createSessionMiddleware(options: {
  redis: Redis;
  keyPrefix: string;
  secret: string;
  secureCookies: boolean;
}): RequestHandler {
  return session({
    name: SESSION_COOKIE_NAME,
    store: new RedisStore({
      client: options.redis,
      prefix: `${options.keyPrefix}:sess:`,
      ttl: SESSION_TTL_SECONDS,
    }),
    secret: options.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      ...SESSION_COOKIE_ATTRIBUTES,
      // "auto" marks the cookie Secure whenever the request arrived over HTTPS (the Vite proxy
      // forwards X-Forwarded-Proto); production always requires HTTPS.
      secure: options.secureCookies ? true : 'auto',
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.destroy((err) => (err ? reject(err) : resolve())),
  );
}
