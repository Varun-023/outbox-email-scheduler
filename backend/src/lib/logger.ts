import { pino, type DestinationStream, type Level, type Logger } from 'pino';

/** Log paths that may carry credentials or session identifiers. */
export const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  '*.password',
  '*.pass',
  '*.secret',
  '*.token',
  '*.accessToken',
  '*.webhookUrl',
];

export interface LoggerOptions {
  level: Level | 'silent';
  /** Identifies the process in shared log output, e.g. "api" or "worker". */
  service: string;
}

export function createLogger(options: LoggerOptions, destination?: DestinationStream): Logger {
  return pino(
    {
      level: options.level,
      base: { service: options.service, pid: process.pid },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    },
    destination,
  );
}
