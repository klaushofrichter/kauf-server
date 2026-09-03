import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireSameOrigin } from '../middleware/requireSameOrigin';
import { verifySession } from '../session';
import {
  listWithLiveState,
  getWithLiveState,
  getFullDetail,
  setBulbState,
  setAllBulbsState,
  renameBulbAndGetState,
} from '../bulbs/service';
import { runDiscoveryScan } from '../bulbs/discovery';
import { parseSetOptions } from '../bulbs/validation';

export const indexRouter = Router();

// Applies to every route below, but only bites on state-changing methods.
// These routes are authorised by the session cookie alone, so they are the
// CSRF-reachable surface; the Bearer-token API in routes/bulbs.ts is not,
// since a cross-origin page cannot set an Authorization header.
indexRouter.use(requireSameOrigin);

const FAVICON_PATH = path.join(__dirname, '../../public/favicon.png');
const FAVICON = fs.readFileSync(FAVICON_PATH);

indexRouter.get('/favicon.png', (_req: Request, res: Response) => {
  res.status(200).type('image/png').send(FAVICON);
});

indexRouter.get(
  '/',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = verifySession(req.cookies?.session);
    const bulbs = await listWithLiveState();
    res.status(200).type('html').send(renderPage(session?.email ?? '', bulbs));
  })
);

indexRouter.get(
  '/ui/bulb/:id',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bulb = await getFullDetail(req.params.id);
    if (!bulb) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(200).json(bulb);
  })
);

indexRouter.post(
  '/ui/bulb/:id/toggle',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const current = await getWithLiveState(req.params.id);
    if (current) {
      await setBulbState(req.params.id, { on: !current.on });
    }
    res.redirect(302, '/');
  })
);

indexRouter.post(
  '/ui/bulb/:id/set',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseSetOptions(req.body ?? {});
    if (!parsed.valid) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await setBulbState(req.params.id, parsed.options!);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (result.rateLimited) {
      res.status(429).json({ error: 'rate limited' });
      return;
    }
    if (!result.success) {
      res.status(502).json({ error: 'bulb unreachable' });
      return;
    }

    const detail = await getFullDetail(req.params.id);
    res.status(200).json(detail);
  })
);

indexRouter.post(
  '/ui/bulb/:id/name',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const name = (req.body ?? {}).name;
    if (typeof name !== 'string' || name.length === 0) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await renameBulbAndGetState(req.params.id, name);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const detail = await getFullDetail(req.params.id);
    res.status(200).json(detail);
  })
);

indexRouter.post(
  '/ui/bulbs/on',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    await setAllBulbsState(true);
    res.redirect(302, '/');
  })
);

indexRouter.post(
  '/ui/bulbs/off',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    await setAllBulbsState(false);
    res.redirect(302, '/');
  })
);

indexRouter.post(
  '/ui/discover',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    await runDiscoveryScan();
    res.redirect(302, '/');
  })
);
