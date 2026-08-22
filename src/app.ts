// src/app.ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import { healthRouter } from './routes/health';
import { bulbsRouter } from './routes/bulbs';
import { authRouter } from './routes/auth';
import { indexRouter } from './routes/index';

export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(healthRouter);
  app.use(bulbsRouter);
  app.use(authRouter);
  app.use(indexRouter);
  return app;
}
