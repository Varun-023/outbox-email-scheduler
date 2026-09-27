import type { RequestHandler, Router } from 'express';
import { Router as expressRouter } from 'express';
import { currentUser } from '../auth/require-auth';
import type { SlackService } from './slack.service';

export function createSlackRouter(deps: {
  slack: SlackService;
  requireAuth: RequestHandler;
  appOrigin: string;
}): Router {
  const { slack, requireAuth, appOrigin } = deps;
  const router = expressRouter();

  router.get('/authorize', requireAuth, (req, res) => {
    const user = currentUser(req);
    const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/';
    const { url } = slack.beginAuth(user.id, returnTo);
    res.redirect(302, url);
  });

  router.get('/callback', async (req, res) => {
    try {
      const code = typeof req.query.code === 'string' ? req.query.code : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      const error = typeof req.query.error === 'string' ? req.query.error : undefined;

      // The callback must arrive in the same signed-in session that started the flow.
      const sessionUserId = req.session?.userId;
      if (!sessionUserId) throw new Error('No signed-in session for the Slack callback');
      const result = await slack.completeAuth({ code, state, error }, sessionUserId);
      res.redirect(302, `${appOrigin}${result.returnTo || '/'}?slack=connected`);
    } catch (err) {
      req.log.warn({ err }, 'Slack OAuth callback failed');
      res.redirect(302, `${appOrigin}/?slack=error`);
    }
  });

  router.get('/', requireAuth, async (req, res) => {
    const user = currentUser(req);
    const status = await slack.getStatus(user.id);
    res.json(status);
  });

  router.post('/disconnect', requireAuth, async (req, res) => {
    const user = currentUser(req);
    await slack.disconnect(user.id);
    res.status(204).end();
  });

  return router;
}
