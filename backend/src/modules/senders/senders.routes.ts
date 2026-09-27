import type { ListSendersResponse } from '@outbox/shared';
import { Router } from 'express';
import { currentUser } from '../auth/require-auth';
import type { SendersService } from './senders.service';

export function createSendersRouter(senders: SendersService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const body: ListSendersResponse = { items: await senders.listForUser(currentUser(req)) };
    res.json(body);
  });

  return router;
}
