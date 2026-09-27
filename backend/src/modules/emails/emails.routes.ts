import { Router } from 'express';
import { z } from 'zod';
import { parseParams } from '../../middleware/validate';
import { currentUser } from '../auth/require-auth';
import type { EmailsService } from './emails.service';

const emailParamsSchema = z.object({ id: z.uuid() });

export function createEmailsRouter(emails: EmailsService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await emails.list(currentUser(req), req.query));
  });

  // Registered before /:id so "counts" is never read as an email id.
  router.get('/counts', async (req, res) => {
    res.json(await emails.counts(currentUser(req)));
  });

  router.get('/:id', async (req, res) => {
    const { id } = parseParams(emailParamsSchema, req);
    res.json(await emails.get(currentUser(req), id));
  });

  return router;
}
