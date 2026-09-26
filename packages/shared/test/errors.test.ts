import { describe, expect, it } from 'vitest';
import { apiErrorBodySchema, ERROR_CODES } from '../src';

describe('apiErrorBodySchema', () => {
  it('accepts an error envelope with field details', () => {
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: [{ path: 'recipients[3].email', message: 'Invalid email address' }],
        requestId: '0192f0c4-7f00-7000-8000-000000000000',
      },
    };

    expect(apiErrorBodySchema.parse(body)).toEqual(body);
  });

  it('accepts an envelope without details', () => {
    const result = apiErrorBodySchema.safeParse({
      error: { code: 'NOT_FOUND', message: 'Email not found', requestId: 'req-1' },
    });

    expect(result.success).toBe(true);
  });

  it('rejects unknown error codes', () => {
    const result = apiErrorBodySchema.safeParse({
      error: { code: 'TEAPOT', message: "I'm a teapot", requestId: 'req-1' },
    });

    expect(result.success).toBe(false);
  });

  it('requires a request id for support and log correlation', () => {
    const result = apiErrorBodySchema.safeParse({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });

    expect(result.success).toBe(false);
  });

  it('defines each error code exactly once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
