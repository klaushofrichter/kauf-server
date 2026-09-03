// src/app.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { bulbsRouter } from './routes/bulbs';
import { authRouter } from './routes/auth';
import { indexRouter } from './routes/index';

export function createApp(): Express {
  const app = express();
  // Trust exactly one hop: the Knative/Kourier ingress proxy in front of the
  // app. This makes req.ip resolve to the real client address (so
  // express-rate-limit keys per-client instead of on the proxy's IP).
  app.set('trust proxy', 1);
  // codeql[js/missing-token-validation]: the cookie-authenticated routes are
  // CSRF-protected by requireSameOrigin (see src/middleware/requireSameOrigin.ts,
  // covered by test/requireSameOrigin.test.ts), which rejects state-changing
  // requests whose Origin/Referer does not match the request's own host, on top
  // of the session cookie's SameSite=Lax. The query only recognises dedicated
  // CSRF-token middleware, so it cannot see either control. Suppressed here at
  // the single reported location rather than disabled repo-wide, so a genuinely
  // unprotected handler added later still trips it.
  app.use(cookieParser());
  app.use(express.json());
  app.use(healthRouter);
  app.use(bulbsRouter);
  app.use(authRouter);
  app.use(indexRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not found' });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
