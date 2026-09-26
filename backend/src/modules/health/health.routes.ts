import { Router } from 'express';

export interface DependencyCheck {
  name: string;
  /** A failing critical dependency makes the API unready (503); others only degrade it. */
  critical: boolean;
  check: () => Promise<void>;
}

export type DependencyStatus = 'ok' | 'down' | 'degraded';

export interface ReadinessBody {
  status: 'ok' | 'degraded' | 'unavailable';
  checks: Record<string, DependencyStatus>;
}

const DEFAULT_CHECK_TIMEOUT_MS = 2_000;

export function createHealthRouter(options: {
  checks: DependencyCheck[];
  timeoutMs?: number;
}): Router {
  const { checks, timeoutMs = DEFAULT_CHECK_TIMEOUT_MS } = options;
  const router = Router();

  // Liveness: the process is up and serving HTTP. Never touches dependencies.
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
  });

  // Readiness: reports each dependency without exposing error details to the caller.
  router.get('/health/ready', async (req, res) => {
    const results = await Promise.all(
      checks.map(async (dependency): Promise<[string, DependencyStatus]> => {
        try {
          await withTimeout(dependency.check(), timeoutMs);
          return [dependency.name, 'ok'];
        } catch (err) {
          req.log.warn({ err, dependency: dependency.name }, 'Readiness check failed');
          return [dependency.name, dependency.critical ? 'down' : 'degraded'];
        }
      }),
    );

    const statuses = results.map(([, status]) => status);
    const unavailable = statuses.includes('down');
    const body: ReadinessBody = {
      status: unavailable ? 'unavailable' : statuses.includes('degraded') ? 'degraded' : 'ok',
      checks: Object.fromEntries(results),
    };
    res.status(unavailable ? 503 : 200).json(body);
  });

  return router;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
