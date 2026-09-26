import { apiErrorBodySchema } from '@outbox/shared';
import express, { type Express } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../../../src/lib/app-error';
import {
  errorHandler,
  formatIssuePath,
  notFoundHandler,
  toAppError,
} from '../../../src/middleware/error-handler';
import { requestId } from '../../../src/middleware/request-id';

function buildApp(configure: (app: Express) => void): Express {
  const app = express();
  app.use(requestId());
  app.use(pinoHttp({ logger: pino({ level: 'silent' }), genReqId: (req) => req.id }));
  app.use(express.json({ limit: '1kb' }));
  configure(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

/** Asserts the response uses the shared envelope and that requestId matches the header. */
function expectEnvelope(res: request.Response) {
  const body = apiErrorBodySchema.parse(res.body);
  expect(body.error.requestId).toBe(res.headers['x-request-id']);
  return body.error;
}

describe('errorHandler', () => {
  it('renders an AppError with its status, code, message and details', async () => {
    const app = buildApp((a) =>
      a.get('/conflict', () => {
        throw new AppError(409, 'INVALID_STATE', 'Email is already sending', [
          { path: 'status', message: 'must be scheduled' },
        ]);
      }),
    );

    const res = await request(app).get('/conflict');

    expect(res.status).toBe(409);
    expect(expectEnvelope(res)).toMatchObject({
      code: 'INVALID_STATE',
      message: 'Email is already sending',
      details: [{ path: 'status', message: 'must be scheduled' }],
    });
  });

  it('turns a ZodError into a 400 with field paths', async () => {
    const schema = z.object({ recipients: z.array(z.object({ email: z.email() })) });
    const app = buildApp((a) =>
      a.post('/validate', (req, res) => {
        res.json(schema.parse(req.body));
      }),
    );

    const res = await request(app)
      .post('/validate')
      .send({ recipients: [{ email: 'a@b.com' }, { email: 'nope' }] });

    expect(res.status).toBe(400);
    const error = expectEnvelope(res);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual([{ path: 'recipients[1].email', message: expect.any(String) }]);
  });

  it('hides the message of unexpected errors, including rejected async handlers', async () => {
    const app = buildApp((a) =>
      a.get('/boom', async () => {
        throw new Error('connect ECONNREFUSED mysql://outbox:hunter2@db');
      }),
    );

    const res = await request(app).get('/boom');

    expect(res.status).toBe(500);
    expect(expectEnvelope(res)).toEqual({
      code: 'INTERNAL',
      message: 'Internal server error',
      requestId: res.headers['x-request-id'],
    });
    expect(res.text).not.toContain('hunter2');
  });

  it('answers malformed JSON with 400 BAD_REQUEST', async () => {
    const app = buildApp((a) => a.post('/echo', (req, res) => res.json(req.body)));

    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"subject": ');

    expect(res.status).toBe(400);
    expect(expectEnvelope(res)).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Request body is not valid JSON',
    });
  });

  it('answers oversized bodies with 413 PAYLOAD_TOO_LARGE', async () => {
    const app = buildApp((a) => a.post('/echo', (req, res) => res.json(req.body)));

    const res = await request(app)
      .post('/echo')
      .send({ body: 'x'.repeat(2_048) });

    expect(res.status).toBe(413);
    expect(expectEnvelope(res).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('answers unknown routes with 404 NOT_FOUND', async () => {
    const res = await request(buildApp(() => {})).get('/api/nope');

    expect(res.status).toBe(404);
    expect(expectEnvelope(res)).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Route GET /api/nope not found',
    });
  });
});

describe('toAppError', () => {
  it('returns AppErrors unchanged', () => {
    const error = new AppError(401, 'UNAUTHENTICATED', 'Sign in required');

    expect(toAppError(error)).toBe(error);
  });

  it('keeps the original error as the cause of an INTERNAL error', () => {
    const original = new Error('socket hang up');

    const error = toAppError(original);

    expect(error).toMatchObject({ status: 500, code: 'INTERNAL' });
    expect(error.cause).toBe(original);
  });

  it('treats non-Error throwables as INTERNAL', () => {
    expect(toAppError('a string')).toMatchObject({ status: 500, code: 'INTERNAL' });
  });
});

describe('formatIssuePath', () => {
  it.each([
    [[], ''],
    [['subject'], 'subject'],
    [['recipients', 3, 'email'], 'recipients[3].email'],
    [[0, 'email'], '[0].email'],
  ] as const)('formats %j as %j', (path, expected) => {
    expect(formatIssuePath(path)).toBe(expected);
  });
});
