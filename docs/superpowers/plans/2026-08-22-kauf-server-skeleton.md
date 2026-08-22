# kauf-server Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a container skeleton with Google OAuth web login/logout, an unprotected `/health` endpoint, and a Bearer-token-protected `GET /bulbs` stub endpoint, running at `https://bulbs.skylar.technology` on the k3s cluster.

**Architecture:** Plain Express + TypeScript app (`createApp()` composition pattern), one router per concern, JWT session cookie for browser auth, static Bearer token for API auth. Built into a multi-stage Alpine Docker image, deployed as a Knative Service via the `kube-setup` repo, promotion-flow CI/CD copied from the sibling `steps-service` repo.

**Tech Stack:** Node 20, TypeScript, Express 4, `google-auth-library`, `jsonwebtoken`, `cookie-parser`, `express-rate-limit`, Vitest + Supertest, Docker, Knative Serving on k3s, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-kauf-server-skeleton-design.md`

## Global Constraints

- Node version: 20 (Alpine base image `node:20-alpine`), matching steps-service.
- TypeScript strict mode on (`tsconfig.json` mirrors steps-service exactly).
- Required env vars (fail fast via `assertRequiredEnv()`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `COOKIE_SECRET`, `ALLOWED_EMAILS`, `BULBS_API_TOKENS`.
- Session cookie name: `session`; 7-day expiry; httpOnly, secure, sameSite=lax.
- API Bearer token env var: `BULBS_API_TOKENS` (comma-separated, constant-time compared).
- Repo: `klaushofrichter/kauf-server` (already created, public, MIT license).
- Namespace / Knative Service name: `bulbs`. Image: `ghcr.io/klaushofrichter/kauf-server`. Domain: `bulbs.skylar.technology`.
- No database, no persisted state in this phase — `/bulbs` returns a hardcoded stub.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.dockerignore`
- Create: `.env.example`
- Create: `test/setup.ts`

**Interfaces:**
- Produces: npm scripts `build`, `start`, `dev`, `test`; Vitest config with `setupFiles: ['./test/setup.ts']` that seeds required env vars for every test run.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "kauf-server",
  "version": "1.0.0",
  "private": true,
  "description": "Container that discovers and controls Kauf smart bulbs on the local network, with a web UI and API.",
  "type": "commonjs",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "tsx --env-file=.env src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "cookie-parser": "^1.4.7",
    "express": "^4.19.2",
    "express-rate-limit": "^8.6.2",
    "google-auth-library": "^10.9.1",
    "jsonwebtoken": "^9.0.3"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.10",
    "@types/express": "^4.17.21",
    "@types/jsonwebtoken": "^9.0.10",
    "@types/node": "^20.14.10",
    "@types/supertest": "^6.0.2",
    "supertest": "^7.0.0",
    "tsx": "^4.16.2",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
  },
});
```

- [ ] **Step 4: Write `test/setup.ts`**

```typescript
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:8080/auth/google/callback';
process.env.COOKIE_SECRET = 'test-cookie-secret-value';
process.env.ALLOWED_EMAILS = 'allowed@example.com';
process.env.BULBS_API_TOKENS = 'test-bulbs-token';
```

- [ ] **Step 5: Write `.gitignore`**

```
node_modules/
dist/
*.log
.env
```

- [ ] **Step 6: Write `.dockerignore`**

```
node_modules
dist
test
.git
*.md
```

- [ ] **Step 7: Write `.env.example`**

```
GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback
COOKIE_SECRET=generate-with-openssl-rand-hex-32
ALLOWED_EMAILS=you@example.com
BULBS_API_TOKENS=generate-with-openssl-rand-hex-32
```

- [ ] **Step 8: Install dependencies**

Run: `npm install`
Expected: `node_modules/` and `package-lock.json` created, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore .dockerignore .env.example test/setup.ts
git commit -m "Scaffold project: package.json, tsconfig, vitest, env template"
```

---

## Task 2: Config env-var validation

**Files:**
- Create: `src/config.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `assertRequiredEnv(): void` — throws `Error` listing every missing var by name if any of `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `COOKIE_SECRET`, `ALLOWED_EMAILS`, `BULBS_API_TOKENS` is unset.

- [ ] **Step 1: Write the failing test**

```typescript
// test/config.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { assertRequiredEnv } from '../src/config';

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'COOKIE_SECRET',
  'ALLOWED_EMAILS',
  'BULBS_API_TOKENS',
];
const original: Record<string, string | undefined> = {};
REQUIRED.forEach((key) => {
  original[key] = process.env[key];
});

describe('assertRequiredEnv', () => {
  afterEach(() => {
    REQUIRED.forEach((key) => {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    });
  });

  it('does not throw when all required vars are set', () => {
    REQUIRED.forEach((key) => {
      process.env[key] = 'some-value';
    });

    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it('throws listing every missing var', () => {
    REQUIRED.forEach((key) => {
      delete process.env[key];
    });

    expect(() => assertRequiredEnv()).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*GOOGLE_REDIRECT_URI.*COOKIE_SECRET.*ALLOWED_EMAILS.*BULBS_API_TOKENS/s
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `src/config.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/config.ts
const REQUIRED_ENV_VARS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'COOKIE_SECRET',
  'ALLOWED_EMAILS',
  'BULBS_API_TOKENS',
] as const;

export function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "Add required-env-var validation"
```

---

## Task 3: Session cookie signing/verification

**Files:**
- Create: `src/session.ts`
- Test: `test/session.test.ts`

**Interfaces:**
- Consumes: `process.env.COOKIE_SECRET` (guaranteed set by Task 2's `assertRequiredEnv` at boot; tests set it via `test/setup.ts`)
- Produces: `signSession(email: string): string`, `verifySession(token: string): { email: string } | null`

- [ ] **Step 1: Write the failing test**

```typescript
// test/session.test.ts
import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signSession, verifySession } from '../src/session';

describe('signSession / verifySession', () => {
  it('round-trips a valid session', () => {
    const token = signSession('allowed@example.com');
    const result = verifySession(token);

    expect(result).toEqual({ email: 'allowed@example.com' });
  });

  it('returns null for a garbage token', () => {
    expect(verifySession('not-a-real-token')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = jwt.sign({ email: 'allowed@example.com' }, 'wrong-secret');
    expect(verifySession(token)).toBeNull();
  });

  it('returns null for an expired token', () => {
    const expired = jwt.sign(
      { email: 'allowed@example.com', exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.COOKIE_SECRET as string
    );
    expect(verifySession(expired)).toBeNull();
  });

  it('returns null for a validly-signed token missing an email claim', () => {
    const noEmail = jwt.sign({ foo: 'bar' }, process.env.COOKIE_SECRET as string);
    expect(verifySession(noEmail)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL — `src/session.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/session.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/session.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/session.ts test/session.test.ts
git commit -m "Add JWT session cookie signing and verification"
```

---

## Task 4: Bearer-token middleware

**Files:**
- Create: `src/middleware/requireToken.ts`
- Test: `test/requireToken.test.ts`

**Interfaces:**
- Produces: `requireToken(envVarName: string)` — returns an Express middleware `(req, res, next) => void` that checks `Authorization: Bearer <token>` against a comma-separated token list read from `process.env[envVarName]`, using `timingSafeEqual`. Responds `401 {error: 'unauthorized'}` on failure.

- [ ] **Step 1: Write the failing test**

```typescript
// test/requireToken.test.ts
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireToken } from '../src/middleware/requireToken';

function buildApp(envVarName: string) {
  const app = express();
  app.get('/protected', requireToken(envVarName), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('requireToken', () => {
  it('rejects a request with no Authorization header', async () => {
    process.env.TEST_TOKENS = 'good-token';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a malformed Authorization header', async () => {
    process.env.TEST_TOKENS = 'good-token';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'good-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a well-formed but wrong token', async () => {
    process.env.TEST_TOKENS = 'good-token';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'Bearer wrong-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('accepts a token that matches one entry in a comma-separated list', async () => {
    process.env.TEST_TOKENS = 'token-one, token-two ,token-three';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'Bearer token-two');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects when the configured env var is empty', async () => {
    process.env.TEST_TOKENS = '';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'Bearer anything');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/requireToken.test.ts`
Expected: FAIL — `src/middleware/requireToken.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/middleware/requireToken.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/requireToken.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/middleware/requireToken.ts test/requireToken.test.ts
git commit -m "Add Bearer-token auth middleware for API routes"
```

---

## Task 5: Auth rate limiter and OAuth-redirect middleware

**Files:**
- Create: `src/middleware/authRateLimit.ts`
- Create: `src/middleware/requireAuth.ts`

**Interfaces:**
- Consumes: `verifySession` from Task 3 (`src/session.ts`)
- Produces: `createAuthRateLimit(): RateLimitRequestHandler` (30 requests / 15 min); `buildGoogleAuthUrl(): string`; `requireAuth(req, res, next): void` — Express middleware that reads the `session` cookie, verifies it, and either calls `next()` or `302`-redirects to Google's OAuth URL.

No standalone tests for this task — both functions are exercised end-to-end in Task 8 (`auth.test.ts`, via the rate limiter on `/auth/google/callback`) and Task 9 (`index.test.ts`, via `requireAuth` gating `/`).

- [ ] **Step 1: Write `src/middleware/authRateLimit.ts`**

```typescript
import rateLimit, { RateLimitRequestHandler } from 'express-rate-limit';

export function createAuthRateLimit(): RateLimitRequestHandler {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  });
}
```

- [ ] **Step 2: Write `src/middleware/requireAuth.ts`**

```typescript
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
```

- [ ] **Step 3: Compile check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/middleware/authRateLimit.ts src/middleware/requireAuth.ts
git commit -m "Add auth rate limiter and session-gated requireAuth middleware"
```

---

## Task 6: Health route

**Files:**
- Create: `src/routes/health.ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces: `healthRouter: Router` mounted on `GET /health`, no auth.

- [ ] **Step 1: Write the failing test**

```typescript
// test/health.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 with a status ok body', async () => {
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

This test imports `createApp` from `src/app.ts`, which doesn't exist until Task 10. Leave it red for now — it will start passing once Task 10 wires the router in. Confirm it fails for the right reason (missing module), not a typo.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/health.test.ts`
Expected: FAIL — cannot find module `../src/app`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/routes/health.ts
import { Router, Request, Response } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});
```

- [ ] **Step 4: Commit** (test stays red until Task 10 — that's expected)

```bash
git add src/routes/health.ts test/health.test.ts
git commit -m "Add unprotected /health route"
```

---

## Task 7: Bulbs stub route

**Files:**
- Create: `src/routes/bulbs.ts`
- Test: `test/bulbs.test.ts`

**Interfaces:**
- Consumes: `requireToken` from Task 4 (`src/middleware/requireToken.ts`)
- Produces: `bulbsRouter: Router` mounted on `GET /bulbs`, protected by `requireToken('BULBS_API_TOKENS')`. Response body: `{ bulbs: [] }` (empty array — no real bulbs discovered yet in this phase).

- [ ] **Step 1: Write the failing test**

```typescript
// test/bulbs.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /bulbs', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).get('/bulbs');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 with a wrong token', async () => {
    const app = createApp();
    const response = await request(app).get('/bulbs').set('Authorization', 'Bearer wrong-token');

    expect(response.status).toBe(401);
  });

  it('returns 200 with an empty bulbs list for a valid token', async () => {
    const app = createApp();
    const response = await request(app).get('/bulbs').set('Authorization', 'Bearer test-bulbs-token');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bulbs: [] });
  });
});
```

(`test-bulbs-token` matches the value seeded in `test/setup.ts` for `BULBS_API_TOKENS`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bulbs.test.ts`
Expected: FAIL — cannot find module `../src/app`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/routes/bulbs.ts
import { Router, Request, Response } from 'express';
import { requireToken } from '../middleware/requireToken';

export const bulbsRouter = Router();

bulbsRouter.get('/bulbs', requireToken('BULBS_API_TOKENS'), (_req: Request, res: Response) => {
  res.status(200).json({ bulbs: [] });
});
```

- [ ] **Step 4: Commit** (test stays red until Task 10)

```bash
git add src/routes/bulbs.ts test/bulbs.test.ts
git commit -m "Add Bearer-token-protected /bulbs stub route"
```

---

## Task 8: Auth routes (Google OAuth callback + logout)

**Files:**
- Create: `src/routes/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `signSession` from Task 3, `createAuthRateLimit` from Task 5.
- Produces: `authRouter: Router` — `GET /auth/google/callback` (exchanges code, verifies ID token, checks `ALLOWED_EMAILS`, sets `session` cookie, redirects to `/`); `GET /auth/logout` (clears cookie, redirects to `/`).

- [ ] **Step 1: Write the failing test**

```typescript
// test/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getTokenMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    getToken: getTokenMock,
    verifyIdToken: verifyIdTokenMock,
  })),
}));

import { createApp } from '../src/app';

describe('GET /auth/google/callback', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('rejects a request with no code', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/google/callback');

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns 401 when the token exchange fails', async () => {
    getTokenMock.mockRejectedValue(new Error('exchange failed'));

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('sets a session cookie and redirects to / for an allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: true }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']?.[0]).toContain('session=');
  });

  it('returns 403 with no cookie for a non-allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'stranger@example.com', email_verified: true }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(403);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('returns 401 with no cookie when the email is unverified, even if allowlisted', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: false }),
    });

    const app = createApp();
    const response = await request(app).get('/auth/google/callback?code=abc123');

    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});

describe('GET /auth/google/callback -> GET / integration', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('accepts the exact cookie the callback route emits when replayed against GET /', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: true }),
    });

    const app = createApp();
    const callbackResponse = await request(app).get('/auth/google/callback?code=abc123');

    expect(callbackResponse.status).toBe(302);
    const setCookieHeader = callbackResponse.headers['set-cookie']?.[0];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('Secure');
    expect(setCookieHeader).toContain('SameSite=Lax');

    const response = await request(app).get('/').set('Cookie', setCookieHeader as string);

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
  });
});

describe('GET /auth/logout', () => {
  it('clears the session cookie and redirects to /', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout').set('Cookie', 'session=some-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    const setCookieHeader = response.headers['set-cookie']?.[0];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('session=;');
  });

  it('redirects to / and clears the cookie even with no existing session', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('logging out then visiting / redirects to Google sign-in again', async () => {
    const app = createApp();
    const logoutResponse = await request(app).get('/auth/logout').set('Cookie', 'session=some-token');
    const setCookieHeader = logoutResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app).get('/').set('Cookie', setCookieHeader);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });
});

describe('GET /auth/google/callback rate limiting', () => {
  it('rate-limits repeated requests', async () => {
    const app = createApp();
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const response = await request(app).get('/auth/google/callback');
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — cannot find module `../src/app`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/routes/auth.ts
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
```

- [ ] **Step 4: Commit** (test stays red until Task 10)

```bash
git add src/routes/auth.ts test/auth.test.ts
git commit -m "Add Google OAuth callback and logout routes"
```

---

## Task 9: Web UI page and index route

**Files:**
- Create: `src/views/page.ts`
- Create: `src/routes/index.ts`
- Test: `test/index.test.ts`

**Interfaces:**
- Consumes: `requireAuth` from Task 5, `createAuthRateLimit` from Task 5.
- Produces: `renderPage(email: string): string`; `indexRouter: Router` mounted on `GET /`, protected by `requireAuth`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/index.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signSession } from '../src/session';

describe('GET /', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('redirects to Google sign-in when the session cookie is invalid', async () => {
    const app = createApp();
    const response = await request(app).get('/').set('Cookie', 'session=not-a-real-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('renders the page for a valid session', async () => {
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    expect(response.text).toContain('allowed@example.com');
    expect(response.text).toContain('/auth/logout');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — cannot find module `../src/app`.

- [ ] **Step 3: Write `src/views/page.ts`**

```typescript
// src/views/page.ts
export function renderPage(email: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kauf Bulbs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    a.logout { color: #666; text-decoration: none; font-size: 0.9rem; }
    a.logout:hover { text-decoration: underline; }
    #bulbs { color: #888; font-style: italic; }
  </style>
</head>
<body>
  <header>
    <h1>Kauf Bulbs</h1>
    <div>
      <span>${email}</span> &middot;
      <a class="logout" href="/auth/logout">Sign out</a>
    </div>
  </header>
  <section id="bulbs">No bulbs discovered yet.</section>
</body>
</html>
`;
}
```

- [ ] **Step 4: Write `src/routes/index.ts`**

```typescript
// src/routes/index.ts
import { Router, Request, Response } from 'express';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import { verifySession } from '../session';

export const indexRouter = Router();

indexRouter.get('/', createAuthRateLimit(), requireAuth, (req: Request, res: Response) => {
  const session = verifySession(req.cookies?.session);
  res.status(200).type('html').send(renderPage(session?.email ?? ''));
});
```

(`requireAuth` already guarantees a valid session by the time this handler runs, so `session` is non-null in practice — the `?? ''` fallback only guards TypeScript's static type.)

- [ ] **Step 5: Commit** (test stays red until Task 10)

```bash
git add src/views/page.ts src/routes/index.ts test/index.test.ts
git commit -m "Add web UI page showing signed-in user and sign-out link"
```

---

## Task 10: App composition and server entrypoint

**Files:**
- Create: `src/app.ts`
- Create: `src/server.ts`

**Interfaces:**
- Consumes: `healthRouter` (Task 6), `bulbsRouter` (Task 7), `authRouter` (Task 8), `indexRouter` (Task 9), `assertRequiredEnv` (Task 2).
- Produces: `createApp(): Express`; server listens on `process.env.PORT` (default 8080).

- [ ] **Step 1: Write `src/app.ts`**

```typescript
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
```

- [ ] **Step 2: Write `src/server.ts`**

```typescript
// src/server.ts
import { createApp } from './app';
import { assertRequiredEnv } from './config';

assertRequiredEnv();

const port = Number(process.env.PORT) || 8080;
const app = createApp();

app.listen(port, () => {
  console.log(`kauf-server listening on port ${port}`);
});
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — every test written in Tasks 6-9 now passes since `src/app.ts` exists and wires all routers.

- [ ] **Step 4: Run the TypeScript compiler**

Run: `npm run build`
Expected: compiles cleanly into `dist/`, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/server.ts
git commit -m "Wire routers into createApp() and add server entrypoint"
```

---

## Task 11: Dockerfile and local container smoke test

**Files:**
- Create: `Dockerfile`

**Interfaces:**
- Produces: a working multi-stage image exposing port 8080, running as the non-root `node` user, with `/health` respondable without any external dependency.

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Build the image locally**

Run: `docker build -t kauf-server:local .`
Expected: builds successfully with no errors.

- [ ] **Step 3: Run the container with test env vars and smoke-test /health**

```bash
docker run -d --name kauf-server-smoketest -p 8080:8080 \
  -e GOOGLE_CLIENT_ID=smoke-test-client-id \
  -e GOOGLE_CLIENT_SECRET=smoke-test-client-secret \
  -e GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback \
  -e COOKIE_SECRET=smoke-test-cookie-secret \
  -e ALLOWED_EMAILS=klaus@klaushofrichter.net \
  -e BULBS_API_TOKENS=smoke-test-bulbs-token \
  kauf-server:local

sleep 2
curl -sf http://localhost:8080/health
echo
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/bulbs
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer smoke-test-bulbs-token" http://localhost:8080/bulbs

docker logs kauf-server-smoketest
docker rm -f kauf-server-smoketest
```

Expected: `/health` returns `{"status":"ok"}` (HTTP 200); unauthenticated `/bulbs` returns `401`; authenticated `/bulbs` returns `200`; container logs show `kauf-server listening on port 8080` with no errors.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "Add multi-stage Dockerfile for production image"
```

---

## Task 12: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# kauf-server

Container that discovers and controls Kauf smart bulbs on the local network,
exposing a web UI and an API. Runs on a local Kubernetes (k3s) cluster.

This phase ships the skeleton: Google OAuth login/logout for the web UI, an
unprotected health check, and a Bearer-token-protected `/bulbs` endpoint
returning a stub response. Bulb discovery and control land in a later phase.

Public web UI: https://bulbs.skylar.technology

## Endpoints

- `GET /health` — unprotected liveness check, returns `{"status":"ok"}`.
- `GET /bulbs` — protected by a Bearer token (`Authorization: Bearer <token>`,
  see `BULBS_API_TOKENS` below). Returns `{"bulbs":[]}` in this phase.
- `GET /` — web UI, requires signing in with Google (restricted to emails in
  `ALLOWED_EMAILS`).
- `GET /auth/google/callback`, `GET /auth/logout` — OAuth plumbing for the
  web UI.

## Development

```bash
npm install
cp .env.example .env   # fill in real values
npm run dev             # runs src/server.ts directly via tsx, no build step
npm test                # runs the Vitest suite once
npm run build            # compiles src/ -> dist/
npm start                # runs the compiled dist/server.js
```

## Environment variables

| Variable               | Purpose                                                        |
|-------------------------|------------------------------------------------------------------|
| `GOOGLE_CLIENT_ID`      | Google OAuth 2.0 client ID                                       |
| `GOOGLE_CLIENT_SECRET`  | Google OAuth 2.0 client secret                                   |
| `GOOGLE_REDIRECT_URI`   | Must match a redirect URI registered on the OAuth client         |
| `COOKIE_SECRET`         | Secret used to sign the session JWT cookie                       |
| `ALLOWED_EMAILS`        | Comma-separated list of emails allowed to sign in to the web UI  |
| `BULBS_API_TOKENS`      | Comma-separated list of valid Bearer tokens for `/bulbs`         |

## Deployment

Deployed as a Knative Service (`bulbs` namespace) on a self-hosted k3s
cluster. Cluster manifests live in the separate `kube-setup` repo, not here.

- Push to `main` → tests run, image built and pushed to
  `ghcr.io/klaushofrichter/kauf-server` (tags `latest` and the commit SHA).
- PR into `production` → tests + CodeQL gate.
- Push to `production` → image built/pushed tagged with the commit SHA,
  `kube-setup`'s `manifests/bulbs/bulbs-ksvc.yaml` updated with the new
  image tag and applied to the cluster via `kubectl` on a self-hosted
  runner.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README"
```

---

## Task 13: GitHub Actions workflows

**Files:**
- Create: `.github/workflows/build-push.yml`
- Create: `.github/workflows/production-checks.yml`
- Create: `.github/workflows/deploy-production.yml`

**Interfaces:**
- Consumes: repo secret `KUBE_SETUP_DEPLOY_TOKEN` (added in Task 14) for the deploy workflow's push access to `kube-setup`.

- [ ] **Step 1: Write `.github/workflows/build-push.yml`**

```yaml
name: Build and publish image

on:
  push:
    branches: [main]

permissions:
  contents: read
  packages: write

jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies and run tests
        run: |
          npm ci
          npm test

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            ghcr.io/klaushofrichter/kauf-server:latest
            ghcr.io/klaushofrichter/kauf-server:${{ github.sha }}
```

- [ ] **Step 2: Write `.github/workflows/production-checks.yml`**

```yaml
name: Production PR checks

on:
  pull_request:
    branches: [production]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - run: npm test

  codeql:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
      actions: read
    steps:
      - uses: actions/checkout@v4

      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript

      - uses: github/codeql-action/analyze@v3
        with:
          output: sarif-results
          upload: never

      - name: Fail if CodeQL found any results
        run: |
          set -euo pipefail
          total=0
          for f in sarif-results/*.sarif; do
            count=$(jq '[.runs[].results[]] | length' "$f")
            total=$((total + count))
          done
          echo "CodeQL findings: $total"
          if [ "$total" -gt 0 ]; then
            echo "::error::CodeQL found $total finding(s) — blocking merge"
            exit 1
          fi
```

- [ ] **Step 3: Write `.github/workflows/deploy-production.yml`**

```yaml
name: Deploy production

on:
  push:
    branches: [production]

permissions:
  contents: read
  packages: write

jobs:
  deploy:
    runs-on: [self-hosted, k3s]
    steps:
      - uses: actions/checkout@v4

      - name: Install kubectl and configure in-cluster access
        run: |
          set -euo pipefail
          if ! command -v kubectl >/dev/null 2>&1; then
            curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
            chmod +x kubectl
            sudo mv kubectl /usr/local/bin/kubectl
          fi
          kubectl version --client
          SA_DIR=/var/run/secrets/kubernetes.io/serviceaccount
          kubectl config set-cluster in-cluster \
            --server=https://kubernetes.default.svc \
            --certificate-authority="${SA_DIR}/ca.crt"
          kubectl config set-credentials deploy-sa --token="$(cat "${SA_DIR}/token")"
          kubectl config set-context in-cluster --cluster=in-cluster --user=deploy-sa --namespace=bulbs
          kubectl config use-context in-cluster

      - name: Log in to ghcr.io
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ghcr.io/klaushofrichter/kauf-server:${{ github.sha }}

      - name: Prune old Docker images
        run: docker system prune -af --filter "until=168h" || true

      - name: Update kube-setup manifest and deploy
        env:
          KUBE_SETUP_DEPLOY_TOKEN: ${{ secrets.KUBE_SETUP_DEPLOY_TOKEN }}
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          rm -rf /tmp/kube-setup-deploy
          git clone "https://x-access-token:${KUBE_SETUP_DEPLOY_TOKEN}@github.com/klaushofrichter/kube-setup.git" /tmp/kube-setup-deploy
          cd /tmp/kube-setup-deploy
          sed -i "s|image: ghcr.io/klaushofrichter/kauf-server:.*|image: ghcr.io/klaushofrichter/kauf-server:${SHA}|" manifests/bulbs/bulbs-ksvc.yaml
          grep -q "image: ghcr.io/klaushofrichter/kauf-server:${SHA}$" manifests/bulbs/bulbs-ksvc.yaml \
            || { echo "::error::manifest image line did not update to ${SHA}"; exit 1; }
          git config user.name "kauf-server-deploy-bot"
          git config user.email "actions@users.noreply.github.com"
          git add manifests/bulbs/bulbs-ksvc.yaml
          if git diff --cached --quiet; then
            echo "No manifest change (image tag already up to date) — skipping commit/push."
          else
            git commit -m "Deploy kauf-server ${SHA}"
            git push
          fi
          kubectl apply -f manifests/bulbs/bulbs-ksvc.yaml
          rm -rf /tmp/kube-setup-deploy

      - name: Verify rollout
        run: |
          set -euo pipefail
          kubectl wait --for=condition=Ready ksvc/bulbs -n bulbs --timeout=120s
          kubectl get ksvc bulbs -n bulbs
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-push.yml .github/workflows/production-checks.yml .github/workflows/deploy-production.yml
git commit -m "Add CI/CD workflows: build-push, production PR checks, deploy"
```

---

## Task 14: kube-setup manifests

**Files:**
- Modify (in the separate `kube-setup` repo): `manifests/00-namespaces.yaml`
- Create (in `kube-setup`): `manifests/bulbs/bulbs-ksvc.yaml`
- Create (in `kube-setup`): `manifests/bulbs/bulbs-domainmapping.yaml`

- [ ] **Step 1: Add the `bulbs` namespace to `kube-setup/manifests/00-namespaces.yaml`**

Append this block (following the exact style of the existing entries in that file):

```yaml
---
apiVersion: v1
kind: Namespace
metadata:
  labels:
    kubernetes.io/metadata.name: bulbs
  name: bulbs
spec:
  finalizers:
  - kubernetes
```

- [ ] **Step 2: Write `kube-setup/manifests/bulbs/bulbs-ksvc.yaml`**

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  annotations:
    networking.knative.dev/ingress.class: kourier.ingress.networking.knative.dev
  name: bulbs
  namespace: bulbs
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/max-scale: '1'
        autoscaling.knative.dev/min-scale: '1'
    spec:
      containerConcurrency: 0
      containers:
      - envFrom:
        - secretRef:
            name: bulbs-oauth
        image: ghcr.io/klaushofrichter/kauf-server:latest
        name: user-container
        ports:
        - containerPort: 8080
          protocol: TCP
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          successThreshold: 1
        resources:
          limits:
            cpu: 500m
            memory: 256Mi
      enableServiceLinks: false
      timeoutSeconds: 300
  traffic:
  - latestRevision: true
    percent: 100
```

(The `:latest` placeholder tag gets overwritten with the real commit SHA the first time `deploy-production.yml` runs — same pattern as `steps-ksvc.yaml`.)

- [ ] **Step 3: Write `kube-setup/manifests/bulbs/bulbs-domainmapping.yaml`**

```yaml
apiVersion: serving.knative.dev/v1beta1
kind: DomainMapping
metadata:
  name: bulbs.skylar.technology
  namespace: bulbs
spec:
  ref:
    apiVersion: serving.knative.dev/v1
    kind: Service
    name: bulbs
    namespace: bulbs
```

- [ ] **Step 4: Apply the namespace to the cluster**

Run (from the `kube-setup` repo, with `KUBECONFIG=~/.kube/k3s-config`):
```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl apply -f manifests/00-namespaces.yaml
kubectl get namespace bulbs
```
Expected: `bulbs` namespace shows `Active`.

- [ ] **Step 5: Commit and push in `kube-setup`**

```bash
git add manifests/00-namespaces.yaml manifests/bulbs/bulbs-ksvc.yaml manifests/bulbs/bulbs-domainmapping.yaml
git commit -m "Add bulbs namespace and Knative manifests for kauf-server"
git push
```

---

## Task 15: Secrets, first deploy, and end-to-end verification

**Files:** none (operational task — Kubernetes secret, GitHub repo secret, branch promotion)

- [ ] **Step 1: Generate real secret values**

```bash
openssl rand -hex 32   # use for COOKIE_SECRET
openssl rand -hex 32   # use for a BULBS_API_TOKENS entry
```

- [ ] **Step 2: Create the `bulbs-oauth` Kubernetes secret**

Using the real `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from the `.env` file already provided, `GOOGLE_REDIRECT_URI=https://bulbs.skylar.technology/auth/google/callback`, `ALLOWED_EMAILS=klaus@klaushofrichter.net`, and the two freshly generated values from Step 1:

```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl -n bulbs create secret generic bulbs-oauth \
  --from-literal=GOOGLE_CLIENT_ID='<value>' \
  --from-literal=GOOGLE_CLIENT_SECRET='<value>' \
  --from-literal=GOOGLE_REDIRECT_URI='https://bulbs.skylar.technology/auth/google/callback' \
  --from-literal=COOKIE_SECRET='<generated>' \
  --from-literal=ALLOWED_EMAILS='klaus@klaushofrichter.net' \
  --from-literal=BULBS_API_TOKENS='<generated>'
kubectl -n bulbs get secret bulbs-oauth
```

Expected: secret created, `kubectl get` shows it with 6 data keys.

- [ ] **Step 3: Add the `KUBE_SETUP_DEPLOY_TOKEN` GitHub repo secret**

Using the value of `GITHUB_KUBE_SETUP_PAT` (verified in this session to have push access to `klaushofrichter/kube-setup`):

```bash
gh secret set KUBE_SETUP_DEPLOY_TOKEN --repo klaushofrichter/kauf-server --body "<GITHUB_KUBE_SETUP_PAT value>"
gh secret list --repo klaushofrichter/kauf-server
```

Expected: `KUBE_SETUP_DEPLOY_TOKEN` appears in the list.

- [ ] **Step 4: Push `main` and confirm the build-push workflow succeeds**

```bash
git push -u origin main
gh run watch --repo klaushofrichter/kauf-server
```

Expected: `Build and publish image` workflow passes; image visible at `ghcr.io/klaushofrichter/kauf-server`.

- [ ] **Step 5: Promote to `production` and confirm deploy**

```bash
git checkout -b production
git push -u origin production
gh run watch --repo klaushofrichter/kauf-server
```

Expected: `Deploy production` workflow passes, ending with `kubectl wait --for=condition=Ready ksvc/bulbs` succeeding.

- [ ] **Step 6: End-to-end verification against the live URL**

```bash
curl -sf https://bulbs.skylar.technology/health
echo
curl -s -o /dev/null -w "%{http_code}\n" https://bulbs.skylar.technology/bulbs
curl -s https://bulbs.skylar.technology/bulbs -H "Authorization: Bearer <BULBS_API_TOKENS value>"
```

Expected: `/health` → `{"status":"ok"}`; unauthenticated `/bulbs` → `401`; authenticated `/bulbs` → `200 {"bulbs":[]}`.

Then open `https://bulbs.skylar.technology/` in a browser, sign in with the allowlisted Google account, confirm the page renders with the email and a "Sign out" link, and confirm signing out redirects back to the Google sign-in screen on the next visit.

- [ ] **Step 7: No commit for this task** — it's operational (secrets, deploy, live verification), not a code change.

---

## Self-Review Notes

- **Spec coverage:** unprotected `/health` (Task 6), Bearer-token `/bulbs` (Task 7), Google OAuth login/logout (Task 8), web UI (Task 9), env-var validation (Task 2), session cookie (Task 3), Docker image (Task 11), README (Task 12), CI/CD workflows (Task 13), cluster manifests (Task 14), secrets + live deploy (Task 15) — all spec sections have a task.
- **Placeholder scan:** no TBD/TODO; the only bracketed placeholders (`<value>`, `<generated>`) are in Task 15's operational shell commands, which by nature take real secret values only known at execution time — not a plan gap.
- **Type consistency:** `requireToken(envVarName: string)` (Task 4) used identically in Task 7 (`requireToken('BULBS_API_TOKENS')`); `signSession`/`verifySession` (Task 3) used identically in Tasks 8 and 9; `renderPage(email: string)` (Task 9) matches its only call site in `routes/index.ts`.
