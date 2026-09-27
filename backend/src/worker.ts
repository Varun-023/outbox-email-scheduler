import { loadEnvOrExit } from './config/env';
import { createLogger } from './lib/logger';
import { startWorkerRuntime } from './workers/run-workers';

const env = loadEnvOrExit();
const logger = createLogger({ level: env.LOG_LEVEL, service: 'worker' });

const runtime = await startWorkerRuntime(env, { logger });

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down workers');

  // Jobs still running when the grace period ends are recovered via BullMQ stall detection.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out; forcing exit');
    process.exit(1);
  }, env.SHUTDOWN_GRACE_MS);
  forceExit.unref();

  await runtime.close();
  logger.info('Workers stopped');
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
