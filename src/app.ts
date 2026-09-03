// src/app.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { httpLogger, logger, responseBodyLogger } from './logger';
import { TRUST_PROXY } from './trustProxy';
import { healthRouter } from './routes/health';
import { bulbsRouter } from './routes/bulbs';
import { authRouter } from './routes/auth';
import { indexRouter } from './routes/index';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', TRUST_PROXY);
  // First, so every request is logged including ones rejected by the
  // middleware below it - the 401/403/429 rejections are the whole point.
  app.use(httpLogger);
  // After httpLogger so reqId is already assigned and the body line can be
  // correlated with its request line. Emits at debug only - see the comment
  // on responseBodyLogger; debug is what the collector drops before Grafana
  // Cloud, and is the reason full bodies are safe to log here at all.
  app.use(responseBodyLogger);
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

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    // Client errors must not be reported as server errors. express.json()
    // throws a SyntaxError carrying status 400 for a malformed body, and
    // this handler previously answered 500 for it and logged at error -
    // so routine bad input looked like the service falling over, in the
    // response and in the new error-level log lines alike.
    const status = (err as { status?: number; statusCode?: number })?.status
      ?? (err as { statusCode?: number })?.statusCode;
    const isClientError = typeof status === 'number' && status >= 400 && status < 500;
    const reqId = (req as Request & { id?: string }).id;

    if (isClientError) {
      logger.warn({ err, reqId }, 'client_error');
      res.status(status).json({ error: 'invalid request' });
      return;
    }

    // Through the same logger so failures land in the same stream as the
    // request lines, correlated by reqId.
    logger.error({ err, reqId }, 'unhandled_error');
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
