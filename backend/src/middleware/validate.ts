import type { Request } from 'express';
import type { z } from 'zod';

// Express 5 exposes req.query as a read-only getter, so handlers parse into local values
// instead of mutating the request. A ZodError becomes a 400 VALIDATION_ERROR envelope.

export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  return schema.parse(req.body ?? {});
}

export function parseQuery<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  return schema.parse(req.query);
}

export function parseParams<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  return schema.parse(req.params);
}
