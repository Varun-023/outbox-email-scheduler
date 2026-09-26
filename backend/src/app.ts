import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestId } from './middleware/request-id';
import { createHealthRouter, type DependencyCheck } from './modules/health/health.routes';

export interface AppDependencies {
  config: Pick<Env, 'TRUST_PROXY'>;
  logger: Logger;
  healthChecks: DependencyCheck[];
}

const JSON_BODY_LIMIT = '1mb';

export function createApp({ config, logger, healthChecks }: AppDependencies): Express {
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

  app.use('/api', createHealthRouter({ checks: healthChecks }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
