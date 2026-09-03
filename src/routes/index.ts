import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import {
  createAuthRateLimit,
  createUiDiscoverRateLimit,
  createProgressRateLimit,
} from '../middleware/authRateLimit';
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
import { runDiscoveryScan, getScanProgress } from '../bulbs/discovery';
import { parseSetOptions } from '../bulbs/validation';

// Express 5 types route params as `string | string[]`, because a path
// pattern can bind the same name more than once. Every `:id` here binds
// exactly one segment, so the value is always a string at runtime - this
// narrows it in one place rather than casting at each call site.
function bulbId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

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
    // Set by the discovery limiter's redirect, so a throttled Refresh
    // explains itself rather than appearing to do nothing - the same
    // failure mode the busy panel was added to fix.
    const notice =
      req.query.scan === 'throttled'
        ? 'A network scan was run less than a minute ago. Please wait a moment before refreshing again.'
        : undefined;
    res.status(200).type('html').send(renderPage(session?.email ?? '', bulbs, notice));
  })
);

indexRouter.get(
  '/ui/bulb/:id',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bulb = await getFullDetail(bulbId(req));
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
    const current = await getWithLiveState(bulbId(req));
    if (current) {
      await setBulbState(bulbId(req), { on: !current.on });
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

    const result = await setBulbState(bulbId(req), parsed.options!);

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

    const detail = await getFullDetail(bulbId(req));
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

    const result = await renameBulbAndGetState(bulbId(req), name);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const detail = await getFullDetail(bulbId(req));
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

indexRouter.get(
  '/ui/discover/progress',
  createProgressRateLimit(),
  requireAuth,
  (_req: Request, res: Response) => {
    res.status(200).json(getScanProgress());
  }
);

indexRouter.post(
  '/ui/discover',
  createAuthRateLimit(),
  requireAuth,
  // The UI's Refresh runs the same expensive sweep as POST /discover, so it
  // carries the same one-per-minute budget. Without it the strict API limit
  // would be trivially sidestepped by anyone holding a session.
  createUiDiscoverRateLimit(),
  asyncHandler(async (_req: Request, res: Response) => {
    await runDiscoveryScan();
    res.redirect(302, '/');
  })
);
