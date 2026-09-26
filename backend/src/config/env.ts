import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

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

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  APP_ORIGIN: originSchema,
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(1),
  DATABASE_URL: urlWithProtocol(['mysql:']),
  DB_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: urlWithProtocol(['redis:', 'rediss:']),
  ELASTICSEARCH_URL: urlWithProtocol(['http:', 'https:']),
  SHUTDOWN_GRACE_MS: z.coerce.number().int().min(1_000).max(120_000).default(25_000),
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
