import type { RequestHandler, Router } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { bullBoardReadOnly, googleOAuthConfig, type Env } from './config/env';
import type { Database } from './db/client';
import { SecretBox } from './lib/crypto';
import { createAuthRouter } from './modules/auth/auth.routes';
import { AuthService } from './modules/auth/auth.service';
import { createGoogleAuthClient, type GoogleAuthClient } from './modules/auth/google-client';
import { requireAdmin, requireAuth } from './modules/auth/require-auth';
import { createSessionMiddleware } from './modules/auth/session';
import { CampaignsRepository } from './modules/campaigns/campaigns.repository';
import { createCampaignsRouter } from './modules/campaigns/campaigns.routes';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { EmailsRepository } from './modules/emails/emails.repository';
import { createEmailsRouter } from './modules/emails/emails.routes';
import { EmailsService } from './modules/emails/emails.service';
import { etherealAccountProvider, type EtherealAccountProvider } from './modules/senders/ethereal';
import { SendersRepository } from './modules/senders/senders.repository';
import { createSendersRouter } from './modules/senders/senders.routes';
import { SendersService } from './modules/senders/senders.service';
import { UsersRepository } from './modules/users/users.repository';
import { createBullBoardRouter } from './queue/bull-board';
import type { Queues } from './queue/queues';

export interface ApiModules {
  session: RequestHandler;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  routers: {
    auth: Router;
    senders: Router;
    campaigns: Router;
    emails: Router;
    bullBoard: Router;
  };
}

export interface ApiInfrastructure {
  db: Database;
  redis: Redis;
  queues: Queues;
}

/** External services tests replace with fakes. */
export interface ApiOverrides {
  google?: GoogleAuthClient | null;
  ethereal?: EtherealAccountProvider;
}

/** Wires repositories → services → routers for the API process. */
export function createApiModules(
  env: Env,
  infra: ApiInfrastructure,
  logger: Logger,
  overrides: ApiOverrides = {},
): ApiModules {
  const googleConfig = googleOAuthConfig(env);
  const google =
    overrides.google !== undefined
      ? overrides.google
      : googleConfig
        ? createGoogleAuthClient(googleConfig)
        : null;
  if (!google) logger.warn('Google OAuth is not configured; sign-in is disabled');

  const secureCookies = env.NODE_ENV === 'production';
  const users = new UsersRepository(infra.db);
  const authenticate = requireAuth(users);

  const senders = new SendersService({
    repository: new SendersRepository(infra.db),
    ethereal: overrides.ethereal ?? etherealAccountProvider,
    secrets: new SecretBox(env.ENCRYPTION_KEY),
    redis: infra.redis,
    keyPrefix: env.BULLMQ_PREFIX,
    autoProvisionCount: env.AUTO_PROVISION_SENDERS,
    defaults: {
      hourlyLimit: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      minDelayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
    },
  });

  const campaigns = new CampaignsService({
    repository: new CampaignsRepository(infra.db),
    senders,
    emailQueue: infra.queues.emails,
    config: {
      maxRecipients: env.MAX_RECIPIENTS_PER_CAMPAIGN,
      maxScheduleAheadDays: env.MAX_SCHEDULE_AHEAD_DAYS,
      windowMs: env.RATE_LIMIT_WINDOW_MS,
    },
    logger: logger.child({ component: 'campaigns' }),
  });

  return {
    session: createSessionMiddleware({
      redis: infra.redis,
      keyPrefix: env.BULLMQ_PREFIX,
      secret: env.SESSION_SECRET,
      secureCookies,
    }),
    requireAuth: authenticate,
    requireAdmin: requireAdmin(env.ADMIN_EMAILS),
    routers: {
      auth: createAuthRouter({
        auth: new AuthService(google, users),
        requireAuth: authenticate,
        appOrigin: env.APP_ORIGIN,
        secureCookies,
      }),
      senders: createSendersRouter(senders),
      campaigns: createCampaignsRouter(campaigns),
      emails: createEmailsRouter(new EmailsService(new EmailsRepository(infra.db))),
      bullBoard: createBullBoardRouter(Object.values(infra.queues), {
        readOnly: bullBoardReadOnly(env),
      }),
    },
  };
}
