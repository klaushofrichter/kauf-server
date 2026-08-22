import jwt from 'jsonwebtoken';

export interface SessionPayload {
  email: string;
}

function getCookieSecret(): string {
  const secret = process.env.COOKIE_SECRET;
  if (!secret) {
    throw new Error('COOKIE_SECRET is not set');
  }
  return secret;
}

export function signSession(email: string): string {
  return jwt.sign({ email }, getCookieSecret(), { expiresIn: '7d' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, getCookieSecret());
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      typeof (decoded as { email?: unknown }).email === 'string'
    ) {
      return { email: (decoded as { email: string }).email };
    }
    return null;
  } catch {
    return null;
  }
}
