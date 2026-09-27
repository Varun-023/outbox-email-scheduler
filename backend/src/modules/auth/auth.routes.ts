import type { MeResponse } from '@outbox/shared';
import { Router, type RequestHandler } from 'express';
import { LoginError, safeReturnTo, type AuthService, type CallbackQuery } from './auth.service';
import { currentUser } from './require-auth';
import {
  SESSION_COOKIE_ATTRIBUTES,
  SESSION_COOKIE_NAME,
  destroySession,
  regenerateSession,
  saveSession,
} from './session';

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 2048 ? value : undefined;
}

export function createAuthRouter(deps: {
  auth: AuthService;
  requireAuth: RequestHandler;
  appOrigin: string;
  secureCookies: boolean;
}): Router {
  const { auth, requireAuth, appOrigin, secureCookies } = deps;
  const router = Router();
  const loginErrorUrl = (code: string) => `${appOrigin}/login?error=${encodeURIComponent(code)}`;

  // Browser navigation: store state/nonce/PKCE verifier in the session, then go to Google.
  router.get('/google', (req, res) => {
    try {
      const { url, pending } = auth.beginLogin(safeReturnTo(req.query.returnTo));
      req.session.oauth = pending;
      res.redirect(302, url);
    } catch (err) {
      if (!(err instanceof LoginError)) throw err;
      req.log.warn({ code: err.code }, err.message);
      res.redirect(302, loginErrorUrl(err.code));
    }
  });

  router.get('/google/callback', async (req, res) => {
    const pending = req.session.oauth;
    delete req.session.oauth; // single use, whatever the outcome
    const query: CallbackQuery = {
      code: stringParam(req.query.code),
      state: stringParam(req.query.state),
      error: stringParam(req.query.error),
    };

    try {
      const user = await auth.completeLogin(pending, query);
      // A fresh session id on login prevents session fixation.
      await regenerateSession(req);
      req.session.userId = user.id;
      await saveSession(req);
      res.redirect(302, `${appOrigin}${pending?.returnTo ?? '/'}`);
    } catch (err) {
      if (!(err instanceof LoginError)) throw err;
      req.log.warn({ code: err.code, err: err.cause ?? err }, 'Google sign-in failed');
      res.redirect(302, loginErrorUrl(err.code));
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    const body: MeResponse = { user: currentUser(req) };
    res.json(body);
  });

  router.post('/logout', async (req, res) => {
    if (req.session) await destroySession(req);
    res.clearCookie(SESSION_COOKIE_NAME, {
      ...SESSION_COOKIE_ATTRIBUTES,
      secure: secureCookies || req.secure,
    });
    res.status(204).end();
  });

  return router;
}
