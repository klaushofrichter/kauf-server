import { Request, Response, NextFunction } from 'express';
import { verifySession } from '../session';

const SESSION_COOKIE = 'session';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export function buildGoogleAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '',
    redirect_uri: process.env.GOOGLE_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: 'openid email',
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = typeof token === 'string' ? verifySession(token) : null;

  if (!session) {
    res.redirect(302, buildGoogleAuthUrl());
    return;
  }

  next();
}
