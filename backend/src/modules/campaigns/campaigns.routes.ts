import { Router } from 'express';
import { currentUser } from '../auth/require-auth';
import type { CampaignsService } from './campaigns.service';

export function createCampaignsRouter(campaigns: CampaignsService): Router {
  const router = Router();

  router.post('/', async (req, res) => {
    const result = await campaigns.create(currentUser(req), req.get('Idempotency-Key'), req.body);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.status).json(result.body);
  });

  return router;
}
