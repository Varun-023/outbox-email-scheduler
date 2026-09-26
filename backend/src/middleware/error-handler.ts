import type { ApiErrorBody } from '@outbox/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/app-error';

/** Unmatched routes get the JSON error envelope instead of Express's HTML page. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = toAppError(err);
  if (appError.status >= 500) {
    req.log.error({ err }, 'Unhandled error');
  }

  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
      requestId: String(req.id),
    },
  };
  res.status(appError.status).json(body);
};

/** Normalises anything thrown into an AppError; unknown errors never leak their message. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      err.issues.map((issue) => ({ path: formatIssuePath(issue.path), message: issue.message })),
    );
  }

  if (isHttpError(err)) {
    if (err.status === 413) {
      return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    if (err.type === 'entity.parse.failed') {
      return new AppError(400, 'BAD_REQUEST', 'Request body is not valid JSON');
    }
    if (err.status >= 400 && err.status < 500 && err.expose) {
      return new AppError(err.status, 'BAD_REQUEST', err.message);
    }
  }

  return new AppError(500, 'INTERNAL', 'Internal server error', undefined, { cause: err });
}

/** Formats a validation path such as ['recipients', 3, 'email'] as "recipients[3].email". */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((formatted, key) => {
    if (typeof key === 'number') return `${formatted}[${key}]`;
    return formatted ? `${formatted}.${String(key)}` : String(key);
  }, '');
}

/** Errors raised by Express's body parsers (the http-errors shape). */
interface HttpError extends Error {
  status: number;
  type?: string;
  expose?: boolean;
}

function isHttpError(err: unknown): err is HttpError {
  return err instanceof Error && typeof (err as Partial<HttpError>).status === 'number';
}
