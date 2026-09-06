import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

export const BEARER_PATTERN = /^Bearer (.+)$/;

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

// Exported so the rate limiter can ask the same question this middleware
// asks, rather than reimplementing it. If the two could disagree, a request
// could be authorised under one rule and bucketed under another.
export function isValidToken(envVarName: string, presentedToken: string | undefined): boolean {
  return (
    typeof presentedToken === 'string' &&
    getValidTokens(envVarName).some((validToken) => tokensMatch(presentedToken, validToken))
  );
}

export function requireToken(envVarName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const presentedToken = req.get('Authorization')?.match(BEARER_PATTERN)?.[1];

    if (!isValidToken(envVarName, presentedToken)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    next();
  };
}
