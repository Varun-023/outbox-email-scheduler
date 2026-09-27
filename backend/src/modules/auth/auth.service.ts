import { timingSafeEqual } from 'node:crypto';
import type { UserRow } from '../../db/schema';
import type { UsersRepository } from '../users/users.repository';
import type { GoogleAuthClient } from './google-client';
import type { PendingLogin } from './session';

const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;

export type LoginErrorCode =
  'oauth_unavailable' | 'oauth_denied' | 'oauth_state' | 'oauth_failed' | 'email_unverified';

/** A sign-in failure the browser is redirected back to /login with. */
export class LoginError extends Error {
  constructor(
    readonly code: LoginErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LoginError';
  }
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
}

/** Only same-site relative paths ("/scheduled"), never "//evil.com" or "/\evil.com". */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 200) return '/';
  return /^\/(?![/\\])[\x21-\x7E]*$/.test(value) ? value : '/';
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AuthService {
  constructor(
    private readonly google: GoogleAuthClient | null,
    private readonly users: UsersRepository,
  ) {}

  beginLogin(returnTo: string, now = Date.now()): { url: string; pending: PendingLogin } {
    if (!this.google) {
      throw new LoginError('oauth_unavailable', 'Google sign-in is not configured on the server');
    }
    const request = this.google.createAuthorizationRequest();
    return {
      url: request.url,
      pending: {
        state: request.state,
        nonce: request.nonce,
        codeVerifier: request.codeVerifier,
        returnTo,
        createdAt: now,
      },
    };
  }

  async completeLogin(
    pending: PendingLogin | undefined,
    query: CallbackQuery,
    now = Date.now(),
  ): Promise<UserRow> {
    if (!this.google) {
      throw new LoginError('oauth_unavailable', 'Google sign-in is not configured on the server');
    }
    if (query.error) {
      throw new LoginError('oauth_denied', `Google returned "${query.error}"`);
    }
    if (
      !pending ||
      now - pending.createdAt > PENDING_LOGIN_TTL_MS ||
      !query.state ||
      !sameToken(query.state, pending.state)
    ) {
      throw new LoginError('oauth_state', 'Missing, expired or mismatched OAuth state');
    }
    if (!query.code) {
      throw new LoginError('oauth_failed', 'Google did not return an authorization code');
    }

    let identity;
    try {
      identity = await this.google.exchangeCode({
        code: query.code,
        codeVerifier: pending.codeVerifier,
        nonce: pending.nonce,
      });
    } catch (err) {
      throw new LoginError('oauth_failed', 'Could not verify the Google sign-in', { cause: err });
    }
    if (!identity.emailVerified) {
      throw new LoginError('email_unverified', 'The Google account email is not verified');
    }

    return this.users.upsertFromGoogle({
      sub: identity.sub,
      email: identity.email,
      name: identity.name,
      picture: identity.picture,
    });
  }
}
