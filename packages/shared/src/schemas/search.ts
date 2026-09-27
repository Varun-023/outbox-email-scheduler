import { z } from 'zod';
import { EMAIL_FOLDERS, EMAIL_STATUSES, folderOf } from './emails';

export const searchEmailsQuerySchema = z
  .strictObject({
    q: z.string().trim().min(1, 'Search query cannot be empty').max(500),
    folder: z.enum(EMAIL_FOLDERS).optional(),
    status: z.enum(EMAIL_STATUSES).optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((query, ctx) => {
    if (query.folder && query.status && folderOf(query.status) !== query.folder) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: `Status "${query.status}" does not belong to the ${query.folder} folder`,
      });
    }
  });

export type SearchEmailsQuery = z.input<typeof searchEmailsQuerySchema>;
export type ParsedSearchEmailsQuery = z.output<typeof searchEmailsQuerySchema>;
