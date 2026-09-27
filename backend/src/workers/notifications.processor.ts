import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { SlackService } from '../modules/slack/slack.service';
import type { RateLimitNotificationJobData } from '../queue/queues';

export function createNotificationsProcessor(slackService: SlackService, logger: Logger) {
  return async function processNotificationJob(
    job: Job<RateLimitNotificationJobData>,
  ): Promise<{ delivered: boolean }> {
    try {
      await slackService.sendRateLimitNotification(job.data);
      return { delivered: true };
    } catch (err) {
      logger.warn({ err, jobId: job.id }, 'Notification job encountered an error');
      return { delivered: false };
    }
  };
}
