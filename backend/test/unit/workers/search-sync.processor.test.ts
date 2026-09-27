import type { Job } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import type { SearchService } from '../../../src/modules/search/search.service';
import {
  createSearchSyncProcessor,
  type IndexEmailsJobData,
} from '../../../src/workers/search-sync.processor';

describe('SearchSyncProcessor', () => {
  const logger = pino({ level: 'silent' });

  it('indexes specified emailIds when provided', async () => {
    const searchService = {
      indexEmails: vi.fn().mockResolvedValue(5),
      syncDirty: vi.fn().mockResolvedValue(0),
    } as unknown as SearchService;

    const processor = createSearchSyncProcessor(searchService, logger);
    const result = await processor({
      id: 'job-1',
      data: { emailIds: ['email-1', 'email-2'] },
    } as Job<IndexEmailsJobData>);

    expect(searchService.indexEmails).toHaveBeenCalledWith(['email-1', 'email-2']);
    expect(result).toEqual({ indexed: 5 });
  });

  it('syncs dirty emails when emailIds is empty or omitted', async () => {
    const searchService = {
      indexEmails: vi.fn().mockResolvedValue(0),
      syncDirty: vi.fn().mockResolvedValue(3),
    } as unknown as SearchService;

    const processor = createSearchSyncProcessor(searchService, logger);
    const result = await processor({
      id: 'job-2',
      data: {},
    } as Job<IndexEmailsJobData>);

    expect(searchService.syncDirty).toHaveBeenCalledWith(100);
    expect(result).toEqual({ indexed: 3 });
  });
});
