import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function getValidTokens(envVarName: string): string[] {
  return (process.env[envVarName] ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function tokensMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export function requireToken(envVarName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.get('Authorization');
    const match = header?.match(/^Bearer (.+)$/);
    const presentedToken = match?.[1];

    const isValid =
      typeof presentedToken === 'string' &&
      getValidTokens(envVarName).some((validToken) => tokensMatch(presentedToken, validToken));

    if (!isValid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    next();
  };
}
