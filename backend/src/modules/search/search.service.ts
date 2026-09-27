import type { Client, estypes } from '@elastic/elasticsearch';
import type {
  AuthUser,
  EmailFolder,
  EmailStatus,
  EmailSummary,
  ListEmailsResponse,
  ParsedSearchEmailsQuery,
} from '@outbox/shared';
import type { Logger } from 'pino';
import { AppError } from '../../lib/app-error';
import type { EmailsRepository } from '../emails/emails.repository';

export interface EmailSearchDocument {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  fromEmail: string;
  fromName: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  preview: string;
  bodyText: string;
  status: EmailStatus;
  folder: EmailFolder;
  scheduledAt: string;
  sentAt: string | null;
  completedAt: string | null;
  deferCount: number;
  version: number;
  createdAt: string;
}

export class SearchService {
  private readonly indexName: string;

  constructor(
    private readonly client: Client,
    private readonly repository: EmailsRepository,
    private readonly logger: Logger,
    prefix = 'outbox',
  ) {
    this.indexName = `${prefix}_emails`;
  }

  async ensureIndex(): Promise<void> {
    try {
      const exists = await this.client.indices.exists({ index: this.indexName });
      if (!exists) {
        await this.client.indices.create({
          index: this.indexName,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              userId: { type: 'keyword' },
              campaignId: { type: 'keyword' },
              senderId: { type: 'keyword' },
              fromEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              fromName: { type: 'text' },
              recipientEmail: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              recipientName: { type: 'text' },
              subject: { type: 'text' },
              preview: { type: 'text' },
              bodyText: { type: 'text' },
              status: { type: 'keyword' },
              folder: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              completedAt: { type: 'date' },
              deferCount: { type: 'integer' },
              version: { type: 'integer' },
              createdAt: { type: 'date' },
            },
          },
        });
        this.logger.info({ index: this.indexName }, 'Elasticsearch index created');
      }
    } catch (err) {
      this.logger.warn({ err, index: this.indexName }, 'Could not ensure Elasticsearch index');
    }
  }

  async indexEmails(emailIds: string[]): Promise<number> {
    if (emailIds.length === 0) return 0;
    try {
      const rows = await this.repository.findForIndexing(emailIds);
      if (rows.length === 0) return 0;

      await this.ensureIndex();

      const operations = rows.flatMap((row) => [
        { index: { _index: this.indexName, _id: row.email.id } },
        {
          id: row.email.id,
          userId: row.email.userId,
          campaignId: row.campaign.id,
          senderId: row.sender.id,
          fromEmail: row.sender.fromEmail,
          fromName: row.sender.fromName,
          recipientEmail: row.email.recipientEmail,
          recipientName: row.email.recipientName,
          subject: row.campaign.subject,
          preview: row.campaign.previewText,
          bodyText: row.campaign.bodyText,
          status: row.email.status,
          folder:
            row.email.folder ??
            (row.email.status === 'sent' || row.email.status === 'failed' ? 'sent' : 'scheduled'),
          scheduledAt: row.email.scheduledAt.toISOString(),
          sentAt: row.email.sentAt ? row.email.sentAt.toISOString() : null,
          completedAt: row.email.completedAt ? row.email.completedAt.toISOString() : null,
          deferCount: row.email.deferCount,
          version: row.email.version,
          createdAt: row.email.createdAt.toISOString(),
        } satisfies EmailSearchDocument,
      ]);

      const bulkRes = await this.client.bulk({ operations, refresh: 'wait_for' });
      if (bulkRes.errors) {
        this.logger.warn(
          { count: bulkRes.items.filter((item) => item.index?.error).length },
          'Some documents failed during Elasticsearch bulk index',
        );
      }

      await this.repository.markIndexed(
        rows.map((r) => ({ id: r.email.id, version: r.email.version })),
      );
      return rows.length;
    } catch (err) {
      this.logger.warn({ err, emailIds }, 'Failed to index emails into Elasticsearch');
      throw err;
    }
  }

  async syncDirty(limit = 100): Promise<number> {
    const dirty = await this.repository.findSearchDirty(limit);
    if (dirty.length === 0) return 0;
    return this.indexEmails(dirty.map((r) => r.email.id));
  }

  async search(user: AuthUser, query: ParsedSearchEmailsQuery): Promise<ListEmailsResponse> {
    try {
      const filters: estypes.QueryDslQueryContainer[] = [{ term: { userId: user.id } }];
      if (query.folder) {
        filters.push({ term: { folder: query.folder } });
      }
      if (query.status) {
        filters.push({ term: { status: query.status } });
      }

      const esQuery: estypes.QueryDslQueryContainer = {
        bool: {
          filter: filters,
          must: [
            {
              multi_match: {
                query: query.q,
                fields: [
                  'subject^3',
                  'recipientEmail^3',
                  'recipientEmail.keyword^3',
                  'recipientName^2',
                  'preview^2',
                  'fromEmail^2',
                  'fromEmail.keyword^2',
                  'fromName^2',
                  'bodyText',
                ],
                type: 'best_fields',
                fuzziness: 'AUTO',
                operator: 'or',
              },
            },
          ],
        },
      };

      const result = await this.client.search<EmailSearchDocument>({
        index: this.indexName,
        query: esQuery,
        size: query.limit,
        sort: [{ _score: { order: 'desc' } }, { scheduledAt: { order: 'desc' } }],
      });

      const hits = result.hits.hits;
      const items: EmailSummary[] = hits
        .map((hit) => hit._source)
        .filter((doc): doc is EmailSearchDocument => Boolean(doc))
        .map((doc) => ({
          id: doc.id,
          campaignId: doc.campaignId,
          to: doc.recipientEmail,
          toName: doc.recipientName,
          subject: doc.subject,
          preview: doc.preview,
          status: doc.status,
          scheduledAt: doc.scheduledAt,
          sentAt: doc.sentAt,
          completedAt: doc.completedAt,
          deferCount: doc.deferCount,
          lastDeferredReason: null,
          sender: { id: doc.senderId, fromEmail: doc.fromEmail },
        }));

      return {
        items,
        nextCursor: null,
      };
    } catch (err) {
      this.logger.warn({ err, userId: user.id, q: query.q }, 'Elasticsearch search failed');
      throw new AppError(503, 'SEARCH_UNAVAILABLE', 'Search is currently unavailable');
    }
  }
}
