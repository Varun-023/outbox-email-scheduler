import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { ApiModules } from './api';
import type { Env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { createHealthRouter, type DependencyCheck } from './modules/health/health.routes';
import { BULL_BOARD_PATH } from './queue/bull-board';

export interface AppDependencies {
  config: Pick<Env, 'TRUST_PROXY'>;
  logger: Logger;
  healthChecks: DependencyCheck[];
  /** Feature routes; omitted when testing the HTTP skeleton on its own. */
  api?: ApiModules;
}

const JSON_BODY_LIMIT = '1mb';

export function createApp({ config, logger, healthChecks, api }: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  // The Vite dev server (or a production reverse proxy) terminates HTTPS in front of the API.
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(requestId());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        return res.statusCode >= 400 ? 'warn' : 'info';
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  // Health checks stay outside the session so probes never touch Redis sessions.
  app.use('/api', createHealthRouter({ checks: healthChecks }));

  if (api) {
    app.use(api.session);
    app.use('/api/auth', api.routers.auth);
    app.use('/api/senders', api.requireAuth, api.routers.senders);
    app.use('/api/campaigns', api.requireAuth, api.routers.campaigns);
    app.use('/api/emails', api.requireAuth, api.routers.emails);
    app.use('/api/integrations/slack', api.routers.slack);
    app.use(BULL_BOARD_PATH, api.requireAuth, api.requireAdmin, api.routers.bullBoard);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
