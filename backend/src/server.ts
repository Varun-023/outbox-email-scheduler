import type { Queue } from 'bullmq';
import { createApiModules } from './api';
import { createApp } from './app';
import { loadEnvOrExit } from './config/env';
import { createDatabase, createDatabasePool, pingDatabase } from './db/client';
import { createLogger } from './lib/logger';
import { createElasticsearchClient, pingElasticsearch } from './modules/search/es-client';
import { closeQueues, createQueues } from './queue/queues';
import { closeRedisConnection, createRedisConnection } from './queue/redis';

const env = loadEnvOrExit();
const logger = createLogger({ level: env.LOG_LEVEL, service: 'api' });

const pool = createDatabasePool({ url: env.DATABASE_URL, connectionLimit: env.DB_POOL_SIZE });
const redis = createRedisConnection(env.REDIS_URL, logger.child({ component: 'redis' }), {
  connectionName: 'outbox-api',
});
// Producers fail fast while Redis is down, so a new campaign is saved as "pending"
// (and enqueued later by the reconciler) instead of hanging the request.
const queueConnection = createRedisConnection(
  env.REDIS_URL,
  logger.child({ component: 'redis-queues' }),
  { connectionName: 'outbox-api-queues', enableOfflineQueue: false },
);
const queues = createQueues(queueConnection, {
  prefix: env.BULLMQ_PREFIX,
  emailJobAttempts: env.EMAIL_JOB_ATTEMPTS,
  emailJobBackoffMs: env.EMAIL_JOB_BACKOFF_MS,
});
for (const queue of Object.values(queues) as Queue[]) {
  queue.on('error', (err) => logger.warn({ err, queue: queue.name }, 'Queue connection error'));
}
const elasticsearch = createElasticsearchClient(env.ELASTICSEARCH_URL);

const app = createApp({
  config: env,
  logger,
  healthChecks: [
    { name: 'mysql', critical: true, check: () => pingDatabase(pool) },
    {
      name: 'redis',
      critical: true,
      check: async () => {
        await redis.ping();
      },
    },
    // Search is a projection: when Elasticsearch is down the API still schedules and sends.
    { name: 'elasticsearch', critical: false, check: () => pingElasticsearch(elasticsearch) },
  ],
  api: createApiModules(env, { db: createDatabase(pool), redis, queues, elasticsearch }, logger),
});

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT }, 'API listening');
});
server.on('error', (err) => {
  logger.fatal({ err }, 'API server failed to start');
  process.exit(1);
});

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down API');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, env.SHUTDOWN_GRACE_MS);
  forceExit.unref();

  // Stop accepting connections and let in-flight requests finish before closing clients.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closeQueues(queues);
  await Promise.allSettled([
    closeRedisConnection(redis),
    closeRedisConnection(queueConnection),
    pool.end(),
    elasticsearch.close(),
  ]);
  logger.info('API stopped');
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
