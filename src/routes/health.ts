import { Router, Request, Response } from 'express';
import { appVersion } from '../version';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', version: appVersion() });
});
