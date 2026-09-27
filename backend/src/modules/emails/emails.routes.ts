import { searchEmailsQuerySchema } from '@outbox/shared';
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/app-error';
import { parseParams } from '../../middleware/validate';
import { currentUser } from '../auth/require-auth';
import type { SearchService } from '../search/search.service';
import type { EmailsService } from './emails.service';

const emailParamsSchema = z.object({ id: z.uuid() });

export function createEmailsRouter(emails: EmailsService, search?: SearchService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await emails.list(currentUser(req), req.query));
  });

  // Registered before /:id so "counts" and "search" are never read as an email id.
  router.get('/counts', async (req, res) => {
    res.json(await emails.counts(currentUser(req)));
  });

  router.get('/search', async (req, res) => {
    if (!search) {
      throw new AppError(503, 'SEARCH_UNAVAILABLE', 'Search is currently unavailable');
    }
    const query = searchEmailsQuerySchema.parse(req.query);
    res.json(await search.search(currentUser(req), query));
  });

  router.get('/:id', async (req, res) => {
    const { id } = parseParams(emailParamsSchema, req);
    res.json(await emails.get(currentUser(req), id));
  });

  return router;
}
