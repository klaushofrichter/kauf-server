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
  // CSRF: the cookie-authenticated /ui routes are protected by
  // requireSameOrigin (registered in routes/index.ts, covered by
  // test/requireSameOrigin.test.ts), on top of the session cookie's
  // SameSite=Lax. CodeQL's js/missing-token-validation still flags this line
  // because it only recognises dedicated CSRF-token middleware; it is filtered
  // in .github/codeql/codeql-config.yml, where the reasoning lives.
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
