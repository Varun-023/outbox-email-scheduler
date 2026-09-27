import type { Job } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { SlackService } from '../../../src/modules/slack/slack.service';
import type { RateLimitNotificationJobData } from '../../../src/queue/queues';
import { createNotificationsProcessor } from '../../../src/workers/notifications.processor';

describe('NotificationsProcessor', () => {
  const logger = pino({ level: 'silent' });

  it('delivers rate limit notification through SlackService', async () => {
    const slackService = {
      sendRateLimitNotification: vi.fn().mockResolvedValue(undefined),
    } as unknown as SlackService;

    const processor = createNotificationsProcessor(slackService, logger);
    const jobData: RateLimitNotificationJobData = {
      userId: 'user-1',
      senderId: 'sender-1',
      campaignId: 'camp-1',
      scope: 'sender',
      windowIdx: 12345,
      limit: 200,
      resumesAt: '2026-10-01T10:00:00.000Z',
    };

    const result = await processor({
      id: 'notif-1',
      data: jobData,
    } as Job<RateLimitNotificationJobData>);

    expect(slackService.sendRateLimitNotification).toHaveBeenCalledWith(jobData);
    expect(result).toEqual({ delivered: true });
  });

  it('handles notification errors gracefully without throwing', async () => {
    const slackService = {
      sendRateLimitNotification: vi.fn().mockRejectedValue(new Error('Slack unreachable')),
    } as unknown as SlackService;

    const processor = createNotificationsProcessor(slackService, logger);
    const jobData: RateLimitNotificationJobData = {
      userId: 'user-1',
      senderId: 'sender-1',
      campaignId: 'camp-1',
      scope: 'sender',
      windowIdx: 12345,
      limit: 200,
      resumesAt: '2026-10-01T10:00:00.000Z',
    };

    const result = await processor({
      id: 'notif-2',
      data: jobData,
    } as Job<RateLimitNotificationJobData>);

    expect(result).toEqual({ delivered: false });
  });
});
