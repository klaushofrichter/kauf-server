// src/routes/bulbs.ts
import { Router, Request, Response } from 'express';
import { requireToken } from '../middleware/requireToken';
import { asyncHandler } from '../middleware/asyncHandler';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import {
  listWithLiveState,
  getFullDetail,
  setBulbState,
  renameBulbAndGetState,
  setAllBulbsState,
} from '../bulbs/service';
import { runDiscoveryScan } from '../bulbs/discovery';
import { parseSetOptions } from '../bulbs/validation';

export const bulbsRouter = Router();
const requireBulbsToken = requireToken('BULBS_API_TOKENS');
// Reuse the existing 30-requests-per-15-minutes limiter used for the OAuth
// callback and session UI routes. This endpoint is protected by a static
// Bearer token, so the limiter's job is to bound brute-force token guessing
// and runaway/looping callers, not to support high-frequency polling -
// 30/15min (2/min) is generous for normal manual bulb control from the UI
// or occasional automation, while still capping the blast radius of a
// leaked token or malfunctioning client. Kept identical to the UI limiter
// for consistency rather than inventing a bespoke value.

bulbsRouter.get(
  '/bulbs',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const bulbs = await listWithLiveState();
    res.status(200).json({ bulbs });
  })
);

bulbsRouter.get(
  '/bulb',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.query.id;
    if (typeof id !== 'string') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const bulb = await getFullDetail(id);
    if (!bulb) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.status(200).json(bulb);
  })
);

bulbsRouter.post(
  '/bulb',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.query.id;
    if (typeof id !== 'string') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const parsed = parseSetOptions(req.body ?? {});
    if (!parsed.valid) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await setBulbState(id, parsed.options!);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    if (!result.success) {
      res.status(502).json({ error: 'bulb unreachable' });
      return;
    }

    res.status(200).json(result.bulb);
  })
);

bulbsRouter.put(
  '/bulb',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.query.id;
    if (typeof id !== 'string') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const name = (req.body ?? {}).name;
    if (typeof name !== 'string' || name.length === 0) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await renameBulbAndGetState(id, name);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.status(200).json(result.bulb);
  })
);

bulbsRouter.post(
  '/bulbs/on',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const results = await setAllBulbsState(true);
    res.status(200).json({ results });
  })
);

bulbsRouter.post(
  '/bulbs/off',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const results = await setAllBulbsState(false);
    res.status(200).json({ results });
  })
);

bulbsRouter.post(
  '/discover',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const bulbsFound = await runDiscoveryScan();
    const bulbs = await listWithLiveState();
    res.status(200).json({ bulbsFound, bulbs });
  })
);
