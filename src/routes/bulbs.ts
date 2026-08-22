import { Router, Request, Response } from 'express';
import { requireToken } from '../middleware/requireToken';

export const bulbsRouter = Router();

bulbsRouter.get('/bulbs', requireToken('BULBS_API_TOKENS'), (_req: Request, res: Response) => {
  res.status(200).json({ bulbs: [] });
});
