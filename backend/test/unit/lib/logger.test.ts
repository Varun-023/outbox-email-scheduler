import { describe, expect, it } from 'vitest';
import { createLogger } from '../../../src/lib/logger';

function captureLogger() {
  const lines: string[] = [];
  const logger = createLogger(
    { level: 'info', service: 'test' },
    { write: (line: string) => void lines.push(line) },
  );
  return { logger, lines };
}

describe('createLogger', () => {
  it('redacts cookies, authorization headers and nested secrets', () => {
    const { logger, lines } = captureLogger();

    logger.info(
      {
        req: { headers: { cookie: 'outbox.sid=abc123', authorization: 'Bearer tok-456' } },
        sender: { password: 'hunter2' },
        slack: { webhookUrl: 'https://hooks.slack.com/services/T0/B0/xyz' },
      },
      'request received',
    );

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string);
    expect(entry.req.headers.cookie).toBe('[redacted]');
    expect(entry.req.headers.authorization).toBe('[redacted]');
    expect(entry.sender.password).toBe('[redacted]');
    expect(entry.slack.webhookUrl).toBe('[redacted]');
    for (const secret of ['abc123', 'tok-456', 'hunter2', 'hooks.slack.com']) {
      expect(lines[0]).not.toContain(secret);
    }
  });

  it('tags every entry with the service name', () => {
    const { logger, lines } = captureLogger();

    logger.info('hello');

    expect(JSON.parse(lines[0] as string)).toMatchObject({ service: 'test', msg: 'hello' });
  });
});
