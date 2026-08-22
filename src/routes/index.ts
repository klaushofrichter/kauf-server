import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import { verifySession } from '../session';

export const indexRouter = Router();

const FAVICON_PATH = path.join(__dirname, '../../public/favicon.png');
const FAVICON = fs.readFileSync(FAVICON_PATH);

indexRouter.get('/favicon.png', (_req: Request, res: Response) => {
  res.status(200).type('image/png').send(FAVICON);
});

indexRouter.get('/', createAuthRateLimit(), requireAuth, (req: Request, res: Response) => {
  const session = verifySession(req.cookies?.session);
  res.status(200).type('html').send(renderPage(session?.email ?? ''));
});
