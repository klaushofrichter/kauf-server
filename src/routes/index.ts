import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import { verifySession } from '../session';
import { listWithLiveState, getWithLiveState, setBulbState } from '../bulbs/service';

export const indexRouter = Router();

const FAVICON_PATH = path.join(__dirname, '../../public/favicon.png');
const FAVICON = fs.readFileSync(FAVICON_PATH);

indexRouter.get('/favicon.png', (_req: Request, res: Response) => {
  res.status(200).type('image/png').send(FAVICON);
});

indexRouter.get('/', createAuthRateLimit(), requireAuth, async (req: Request, res: Response) => {
  const session = verifySession(req.cookies?.session);
  const bulbs = await listWithLiveState();
  res.status(200).type('html').send(renderPage(session?.email ?? '', bulbs));
});

indexRouter.post(
  '/ui/bulb/:id/toggle',
  createAuthRateLimit(),
  requireAuth,
  async (req: Request, res: Response) => {
    const current = await getWithLiveState(req.params.id);
    if (current) {
      await setBulbState(req.params.id, { on: !current.on });
    }
    res.redirect(302, '/');
  }
);
