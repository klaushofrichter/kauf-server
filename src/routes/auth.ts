import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { signSession } from '../session';
import { createAuthRateLimit } from '../middleware/authRateLimit';

export const authRouter = Router();
const authRateLimit = createAuthRateLimit();

const SESSION_COOKIE = 'session';
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getAllowedEmails(): string[] {
  return (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email.length > 0);
}

authRouter.get('/auth/google/callback', authRateLimit, async (req: Request, res: Response) => {
  const code = req.query.code;

  if (typeof code !== 'string' || code.length === 0) {
    res.status(401).json({ error: 'missing authorization code' });
    return;
  }

  const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  let email: string | undefined;
  try {
    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token ?? '',
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    email = payload?.email_verified ? payload.email : undefined;
  } catch {
    res.status(401).json({ error: 'authentication failed' });
    return;
  }

  if (!email) {
    res.status(401).json({ error: 'authentication failed' });
    return;
  }

  if (!getAllowedEmails().includes(email)) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  res.cookie(SESSION_COOKIE, signSession(email), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS,
  });
  res.redirect(302, '/');
});

authRouter.get('/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
  res.redirect(302, '/');
});
