import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

export function createAuthRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
}
