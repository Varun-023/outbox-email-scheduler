import type { Env, FaultPoint } from '../config/env';

export type FaultInjector = (point: FaultPoint) => void;

/**
 * Simulates a hard crash at a chosen point in the send pipeline, for failure-scenario tests.
 * Does nothing unless NODE_ENV=test and FAULT_POINT names this point.
 */
export function createFaultInjector(env: Pick<Env, 'NODE_ENV' | 'FAULT_POINT'>): FaultInjector {
  if (env.NODE_ENV !== 'test' || !env.FAULT_POINT) return () => {};
  const target = env.FAULT_POINT;
  return (point) => {
    if (point !== target) return;
    process.stderr.write(`FAULT_POINT ${point}: exiting without cleanup\n`);
    process.exit(137);
  };
}
