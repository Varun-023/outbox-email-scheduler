import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { SearchService } from '../modules/search/search.service';

export interface IndexEmailsJobData {
  emailIds?: string[];
}

export function createSearchSyncProcessor(searchService: SearchService, logger: Logger) {
  return async function processSearchSyncJob(
    job: Job<IndexEmailsJobData>,
  ): Promise<{ indexed: number }> {
    const emailIds = job.data?.emailIds;
    if (emailIds && emailIds.length > 0) {
      const indexed = await searchService.indexEmails(emailIds);
      logger.info({ jobId: job.id, indexed }, 'Indexed emails in Elasticsearch');
      return { indexed };
    }

    const indexed = await searchService.syncDirty(100);
    logger.info({ jobId: job.id, indexed }, 'Synced dirty emails in Elasticsearch');
    return { indexed };
  };
}
