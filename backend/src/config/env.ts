import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const FAULT_POINTS = [
  'after_claim',
  'after_smtp_before_receipt',
  'after_receipt',
  'after_sent_update',
] as const;
export type FaultPoint = (typeof FAULT_POINTS)[number];

/** A required string; the message deliberately never echoes the value, which may hold credentials. */
const requiredString = () =>
  z.string({ error: (issue) => (issue.input === undefined ? 'is required' : undefined) });

function urlWithProtocol(protocols: readonly string[]) {
  return requiredString().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `must be a valid URL using ${protocols.join(' or ')}` },
  );
}

const originSchema = requiredString().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
    } catch {
      return false;
    }
  },
  { message: 'must be an origin such as https://localhost:5173 (no path or trailing slash)' },
);

const booleanString = z
  .enum(['true', 'false'], { error: 'must be "true" or "false"' })
  .transform((value) => value === 'true');

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    APP_ORIGIN: originSchema,
    API_PORT: int(1, 65_535).default(4000),
    TRUST_PROXY: int(0, 10).default(1),
    SHUTDOWN_GRACE_MS: int(1_000, 120_000).default(25_000),

    DATABASE_URL: urlWithProtocol(['mysql:']),
    DB_POOL_SIZE: int(1, 100).default(10),
    REDIS_URL: urlWithProtocol(['redis:', 'rediss:']),
    BULLMQ_PREFIX: z
      .string()
      .regex(/^[a-z0-9-]+$/i, 'must contain only letters, digits and hyphens')
      .default('outbox'),
    ELASTICSEARCH_URL: urlWithProtocol(['http:', 'https:']),

    SESSION_SECRET: requiredString().min(32, 'must be at least 32 characters'),
    ENCRYPTION_KEY: requiredString().refine(
      (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, 'base64').length === 32,
      { message: 'must be the base64 encoding of exactly 32 random bytes' },
    ),
    ADMIN_EMAILS: z
      .string()
      .default('')
      .transform((list) =>
        list
          .split(',')
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      ),
    BULL_BOARD_READ_ONLY: booleanString.optional(),

    // Google sign-in is optional at boot so the worker and tests run without credentials;
    // the login route explains the missing configuration instead.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: urlWithProtocol(['http:', 'https:']).optional(),

    AUTO_PROVISION_SENDERS: int(0, 5).default(2),
    SMTP_CONNECTION_TIMEOUT_MS: int(1_000, 120_000).default(10_000),
    SMTP_SOCKET_TIMEOUT_MS: int(1_000, 300_000).default(30_000),
    // Ethereal supports STARTTLS; tests point senders at a plain local fake SMTP server.
    SMTP_REQUIRE_TLS: booleanString.default(true),
    MESSAGE_ID_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+$/i, 'must be a hostname')
      .default('outbox.local'),

    EMAIL_WORKER_CONCURRENCY: int(1, 100).default(5),
    EMAIL_JOB_ATTEMPTS: int(1, 20).default(5),
    EMAIL_JOB_BACKOFF_MS: int(100, 3_600_000).default(15_000),
    EMAIL_WORKER_LOCK_DURATION_MS: int(1_000, 600_000).default(30_000),
    EMAIL_WORKER_STALLED_INTERVAL_MS: int(500, 600_000).default(30_000),
    MAX_EMAILS_PER_HOUR_PER_SENDER: int(1, 1_000_000).default(200),
    MIN_DELAY_BETWEEN_EMAILS_MS: int(0, 3_600_000).default(2_000),
    RATE_LIMIT_WINDOW_MS: int(1_000, 86_400_000).default(3_600_000),
    MAX_RECIPIENTS_PER_CAMPAIGN: int(1, 100_000).default(5_000),
    MAX_SCHEDULE_AHEAD_DAYS: int(1, 365).default(90),
    SEND_LEASE_MS: int(1_000, 3_600_000).default(90_000),

    UNCERTAIN_DELIVERY_POLICY: z.enum(['fail', 'resend']).default('fail'),
    RECONCILE_INTERVAL_MS: int(0, 86_400_000).default(60_000),

    FAULT_POINT: z.enum(FAULT_POINTS).optional(),
  })
  .superRefine((env, ctx) => {
    const google = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI];
    if (google.some(Boolean) && !google.every(Boolean)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_CLIENT_ID'],
        message:
          'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set together',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates environment variables. Empty strings count as "not set", so blank entries
 * copied from .env.example fall back to their defaults or are reported as missing.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const provided = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(provided);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return result.data;
}

/** Entry points validate the environment up front and exit with a readable message. */
export function loadEnvOrExit(source: Record<string, string | undefined> = process.env): Env {
  try {
    return parseEnv(source);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleOAuthConfig(env: Env): GoogleOAuthConfig | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

/** Bull Board allows retry/remove/promote; default to read-only outside development. */
export function bullBoardReadOnly(env: Env): boolean {
  return env.BULL_BOARD_READ_ONLY ?? env.NODE_ENV !== 'development';
}
