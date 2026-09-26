import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { requestId } from '../../../src/middleware/request-id';

const app = express();
app.use(requestId());
app.get('/', (req, res) => {
  res.json({ id: req.id });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('requestId', () => {
  it('generates a UUID and echoes it in the response header', async () => {
    const res = await request(app).get('/');

    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.body.id).toBe(res.headers['x-request-id']);
  });

  it('reuses a well-formed incoming request id', async () => {
    const res = await request(app).get('/').set('X-Request-Id', 'proxy-abc_123.4');

    expect(res.headers['x-request-id']).toBe('proxy-abc_123.4');
  });

  it.each([['has spaces'], ['<script>'], ['x'.repeat(129)]])(
    'replaces an unsafe incoming id (%s)',
    async (incoming) => {
      const res = await request(app).get('/').set('X-Request-Id', incoming);

      expect(res.headers['x-request-id']).toMatch(UUID);
    },
  );
});
