import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const REQUEST_ID_HEADER = 'X-Request-Id';
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;

/**
 * Reuses a well-formed incoming X-Request-Id (e.g. from a proxy) or generates one,
 * and echoes it back so clients can quote it when reporting problems.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    req.id = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  };
}
