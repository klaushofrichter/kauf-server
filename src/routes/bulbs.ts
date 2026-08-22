// src/routes/bulbs.ts
import { Router, Request, Response } from 'express';
import { requireToken } from '../middleware/requireToken';
import { asyncHandler } from '../middleware/asyncHandler';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import {
  listWithLiveState,
  getWithLiveState,
  setBulbState,
  renameBulbAndGetState,
} from '../bulbs/service';
import { SetStateOptions } from '../bulbs/deviceApi';

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

function parseSetBody(body: Record<string, unknown>): { valid: boolean; options?: SetStateOptions } {
  const options: SetStateOptions = {};

  if (body.on !== undefined) {
    if (typeof body.on !== 'boolean') return { valid: false };
    options.on = body.on;
  }

  if (body.brightness !== undefined) {
    if (typeof body.brightness !== 'number' || body.brightness < 0 || body.brightness > 100) {
      return { valid: false };
    }
    options.brightness = body.brightness;
  }

  for (const key of ['r', 'g', 'b'] as const) {
    const value = body[key];
    if (value !== undefined) {
      if (typeof value !== 'number' || value < 0 || value > 255) return { valid: false };
      options[key] = value;
    }
  }

  if (body.transition !== undefined) {
    if (typeof body.transition !== 'number' || body.transition < 0) return { valid: false };
    options.transition = body.transition;
  }

  return { valid: true, options };
}

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

    const bulb = await getWithLiveState(id);
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

    const parsed = parseSetBody(req.body ?? {});
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
