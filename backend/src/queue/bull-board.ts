import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import type { Queue } from 'bullmq';
import type { Router } from 'express';

export const BULL_BOARD_PATH = '/admin/queues';

/** Live queue dashboard; the app mounts it behind requireAuth + requireAdmin. */
export function createBullBoardRouter(queues: Queue[], options: { readOnly: boolean }): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue, { readOnlyMode: options.readOnly })),
    serverAdapter,
    options: { uiConfig: { boardTitle: 'OutBox queues' } },
  });
  return serverAdapter.getRouter() as Router;
}
