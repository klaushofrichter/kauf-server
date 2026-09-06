import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createAuthRateLimit, rateLimitKey } from '../src/middleware/authRateLimit';
import { signSession } from '../src/session';

// A single limiter shared by the route, as the real routers do, so these
// exercise bucket separation rather than the key function in isolation.
function limitedApp(limit = 3) {
  const app = express();
  app.set('trust proxy', ['loopback', '10.42.0.0/16', '10.43.0.0/16']);
  app.use(cookieParser());
  const limiter = createAuthRateLimit();
  app.get('/thing', limiter, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return { app, limit };
}

// The real limit is 30/15min; hammering it 31 times per case is slow and
// tells us nothing extra. These drive it to exhaustion once and then check
// who else is affected.
async function exhaust(app: express.Express, headers: Record<string, string>) {
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const res = await request(app).get('/thing').set(headers);
    last = res.status;
  }
  return last;
}

let app: express.Express;
beforeEach(() => {
  ({ app } = limitedApp());
});

describe('rate limit buckets are per principal, not shared', () => {
  it('gives a valid token and a signed-in user independent budgets', async () => {
    // Both principals must be real. An earlier version of this test used two
    // INVALID bearer values and passed, because the limiter was then keying
    // on whatever was presented - the test was asserting the bypass rather
    // than the property it was named for.
    expect(await exhaust(app, { Authorization: 'Bearer test-bulbs-token' })).toBe(429);

    const other = await request(app)
      .get('/thing')
      .set({ Cookie: `session=${signSession('someone@example.com')}` });
    expect(other.status).toBe(200);
  });

  it('gives two signed-in users independent budgets', async () => {
    const a = `session=${signSession('a@example.com')}`;
    const b = `session=${signSession('b@example.com')}`;
    expect(await exhaust(app, { Cookie: a })).toBe(429);

    const other = await request(app).get('/thing').set({ Cookie: b });
    expect(other.status).toBe(200);
  });

  it('does not let anonymous traffic exhaust an authenticated caller', async () => {
    // The scenario the old global bucket allowed: unauthenticated noise
    // locking out the signed-in user.
    expect(await exhaust(app, {})).toBe(429);

    const authed = await request(app)
      .get('/thing')
      .set({ Authorization: 'Bearer test-bulbs-token' });
    expect(authed.status).toBe(200);

    const session = await request(app)
      .get('/thing')
      .set({ Cookie: `session=${signSession('user@example.com')}` });
    expect(session.status).toBe(200);
  });

  it('still limits a single principal, rather than counting nothing', async () => {
    // Separation is only useful if each bucket is enforced.
    expect(await exhaust(app, { Authorization: 'Bearer test-bulbs-token' })).toBe(429);
  });
});

describe('rateLimitKey only grants a bucket to a token that validates', () => {
  // Regression. The bucket was previously keyed on whatever Bearer value was
  // presented, without checking it first, so a caller could mint a fresh
  // budget per request by varying the header - the limit was absent for
  // exactly the unauthenticated traffic it exists to bound, while still
  // behaving correctly for real callers.
  function reqWithAuth(value?: string): never {
    return {
      get(name: string) {
        return name.toLowerCase() === 'authorization' ? value : undefined;
      },
      cookies: {},
      ip: '203.0.113.7',
    } as never;
  }

  it('gives distinct invalid tokens the SAME key, not one each', () => {
    const a = rateLimitKey(reqWithAuth('Bearer invented-one'));
    const b = rateLimitKey(reqWithAuth('Bearer invented-two'));
    const c = rateLimitKey(reqWithAuth('Bearer invented-three'));

    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('falls back to the shared address bucket for an invalid token', () => {
    // Not merely "the same as each other" - it must be the same bucket
    // unauthenticated traffic already uses, or invalid tokens still get a
    // pool of their own.
    const invalid = rateLimitKey(reqWithAuth('Bearer invented'));
    const anonymous = rateLimitKey(reqWithAuth(undefined));

    expect(invalid).toBe(anonymous);
    expect(invalid.startsWith('ip:')).toBe(true);
  });

  it('still gives a valid token its own bucket, distinct from anonymous', () => {
    // The other direction: the fix must not collapse real callers into the
    // shared bucket, which would make one noisy client able to starve them.
    const valid = rateLimitKey(reqWithAuth('Bearer test-bulbs-token'));
    const anonymous = rateLimitKey(reqWithAuth(undefined));

    expect(valid.startsWith('t:')).toBe(true);
    expect(valid).not.toBe(anonymous);
  });

  it('never puts the token itself in the key', () => {
    expect(rateLimitKey(reqWithAuth('Bearer test-bulbs-token'))).not.toContain('test-bulbs-token');
  });
});

describe('rateLimitKey', () => {
  function reqWith(over: Record<string, unknown>): never {
    return {
      get(name: string) {
        return (over.headers as Record<string, string>)?.[name.toLowerCase()];
      },
      cookies: over.cookies ?? {},
      ip: over.ip ?? '203.0.113.7',
    } as never;
  }

  it('keys a valid bearer token by hash, never including the token itself', () => {
    const key = rateLimitKey(reqWith({ headers: { authorization: 'Bearer test-bulbs-token' } }));

    expect(key.startsWith('t:')).toBe(true);
    expect(key).not.toContain('test-bulbs-token');
  });

  it('keys a valid session by email', () => {
    const key = rateLimitKey(reqWith({ cookies: { session: signSession('user@example.com') } }));

    expect(key).toBe('s:user@example.com');
  });

  it('ignores an unsigned session cookie and falls back to the address', () => {
    // Otherwise anyone could mint a fresh budget by inventing a cookie.
    const key = rateLimitKey(reqWith({ cookies: { session: 'not-a-real-jwt' } }));

    expect(key.startsWith('ip:')).toBe(true);
  });

  it('falls back to the address when there is no principal', () => {
    expect(rateLimitKey(reqWith({ ip: '198.51.100.4' }))).toBe('ip:198.51.100.4');
  });
});
