# Bulb Card UI, Modal, Bulk Controls, and Manual Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the web UI from a plain list to a responsive card grid with a detail modal (brightness/color controls, firmware/MAC info), add bulk all-on/all-off and manual discovery-refresh (both as public API endpoints and UI actions), add Playwright E2E coverage for the new client-side JavaScript, wire E2E into CI, and publish an API reference document for external integrators.

**Architecture:** Extends the existing `src/bulbs/` domain module (no new domain files) and the existing dual-surface routing pattern (public Bearer-token API in `src/routes/bulbs.ts`, session-cookie UI actions in `src/routes/index.ts`, both backed by the same `src/bulbs/service.ts` functions). The frontend gains its first client-side JavaScript — vanilla, inlined, no framework or build step — for the modal and live card updates.

**Tech Stack:** Existing stack (Node 20, TypeScript, Express, Vitest + Supertest) plus `@playwright/test` (new devDependency) for browser-level E2E tests.

**Spec:** `docs/superpowers/specs/2026-08-22-bulb-cards-ui-design.md`

## Global Constraints

- `GET /bulb?id=` response gains `firmwareVersion: string | null` and `esphomeVersion: string | null`, fetched live via `pingBulb` in parallel with the existing live-state fetch. Independently nullable — a bulb can be `online: true` with `firmwareVersion: null` or vice versa.
- `GET /bulbs` (the list) is **unchanged** — no firmware round-trip per bulb on every list load.
- New public API routes (`POST /bulbs/on`, `POST /bulbs/off`, `POST /discover`) use the same `requireToken('BULBS_API_TOKENS')` + `createAuthRateLimit()` middleware chain already applied to the existing `bulbs` routes.
- New UI routes (`GET /ui/bulb/:id`, `POST /ui/bulb/:id/set`, `POST /ui/bulbs/on`, `POST /ui/bulbs/off`, `POST /ui/discover`) use the same `requireAuth` + `createAuthRateLimit()` chain already applied to the existing UI routes. The browser never sees the API token.
- `POST /bulb?id=` and `POST /ui/bulb/:id/set` share one validation function (`parseSetOptions`, extracted to `src/bulbs/validation.ts` from its current home inline in `src/routes/bulbs.ts`) — not duplicated logic in two files.
- The existing `POST /ui/bulb/:id/toggle` (redirect-based, on/off only) **stays** — it's the no-JS fallback for each card's own toggle button, separate from the modal's JSON-based setter.
- All new client-side JavaScript is vanilla, inlined in `src/views/page.ts` the same way the existing CSS is inlined — no framework, no bundler, no build step added.
- `npm test` (the CI-gating Vitest command) must **not** pick up Playwright spec files — `vitest.config.ts` needs an explicit exclude for `test/e2e/**`.
- Playwright E2E tests run against a real server process launched by Playwright's own `webServer` config, using the real `test/mockBulbServer.ts` (already built) as the fake device, a session cookie injected via the same `signSession()`/`COOKIE_SECRET` mechanism the existing Vitest route tests already use to bypass real OAuth, and `BULB_SCAN_CIDR=127.0.0.1/32` (yields zero scan addresses) so the automatic startup discovery scan never interferes with the seeded fixture data.
- E2E tests are wired into **both** `build-push.yml` and `production-checks.yml`, alongside the existing `npm test` step — per explicit instruction, this is "comprehensive tests in CI," not an optional/separate script.

---

## Task 1: Device API firmware fields

**Files:**
- Modify: `src/bulbs/deviceApi.ts`
- Modify: `test/deviceApi.test.ts`

**Interfaces:**
- Produces: `PingResult` gains `firmwareVersion: string | null` and `esphomeVersion: string | null`.

- [ ] **Step 1: Update the failing test**

In `test/deviceApi.test.ts`, find the `'returns device identity for a genuine Kauf bulb'` test inside `describe('pingBulb', ...)` and change its expectation from:

```typescript
    expect(result).toEqual({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
    });
```

to:

```typescript
    expect(result).toEqual({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      firmwareVersion: '2.00(u)',
      esphomeVersion: '2026.3.0',
    });
```

(`PING_FRAME`'s fixture data, unchanged, already has `"esph_v":"2026.3.0"` and `"proj_v":"2.00(u)"` — this test asserted an incomplete object before.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/deviceApi.test.ts`
Expected: FAIL — the current `pingBulb` doesn't return `firmwareVersion`/`esphomeVersion`, so the object comparison fails.

- [ ] **Step 3: Update `src/bulbs/deviceApi.ts`**

Change the `PingResult` interface:

```typescript
export interface PingResult {
  mac: string;
  hostname: string;
  title: string;
  firmwareVersion: string | null;
  esphomeVersion: string | null;
}
```

In `pingBulb`, change the object construction inside the `onFrame` callback:

```typescript
      if (parsed.proj_n === KAUF_PROJECT_NAME) {
        result = {
          mac: parsed.mac_addr,
          hostname: parsed.hostname,
          title: parsed.title,
          firmwareVersion: typeof parsed.proj_v === 'string' ? parsed.proj_v : null,
          esphomeVersion: typeof parsed.esph_v === 'string' ? parsed.esph_v : null,
        };
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/deviceApi.test.ts`
Expected: PASS (all tests in the file, including the updated one)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — `test/deviceApi.integration.test.ts` (which asserts `pingBulb`'s return against the real mock server, not a hardcoded object literal via `.toEqual` on the whole shape for most tests) should be unaffected; double check by reading its assertions if anything fails.

- [ ] **Step 6: Commit**

```bash
git add src/bulbs/deviceApi.ts test/deviceApi.test.ts
git commit -m "Add firmwareVersion/esphomeVersion to pingBulb's PingResult"
```

---

## Task 2: Service layer — full detail and bulk state

**Files:**
- Modify: `src/bulbs/service.ts`
- Modify: `test/service.test.ts`

**Interfaces:**
- Consumes: `pingBulb` from Task 1 (`src/bulbs/deviceApi.ts`).
- Produces: `BulbDetail` (extends `BulbWithState` with `firmwareVersion`, `esphomeVersion`); `getFullDetail(id: string): Promise<BulbDetail | null>`; `setAllBulbsState(on: boolean): Promise<{id: string, success: boolean}[]>`.

- [ ] **Step 1: Write the failing tests**

In `test/service.test.ts`, update the mock declarations at the top of the file — add `pingBulb` to the `deviceApi` mock:

```typescript
vi.mock('../src/bulbs/deviceApi', () => ({
  getState: vi.fn(),
  setState: vi.fn(),
  pingBulb: vi.fn(),
}));
```

and update the import line:

```typescript
import { getState, setState, pingBulb } from '../src/bulbs/deviceApi';
```

and the import from `service.ts` to add the two new functions:

```typescript
import { listWithLiveState, getWithLiveState, setBulbState, renameBulbAndGetState, getFullDetail, setAllBulbsState } from '../src/bulbs/service';
```

Then add these two new `describe` blocks at the end of the file, after the existing `renameBulbAndGetState` describe block:

```typescript
describe('getFullDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for an unknown id', async () => {
    vi.mocked(getBulb).mockReturnValue(null);

    expect(await getFullDetail('nonexistent')).toBeNull();
  });

  it('merges live state and live firmware info', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(getState).mockResolvedValue({ on: true, brightness: 55, r: 39, g: 183, b: 255 });
    vi.mocked(pingBulb).mockResolvedValue({
      mac: STORED.mac,
      hostname: STORED.id,
      title: STORED.name,
      firmwareVersion: '2.00(u)',
      esphomeVersion: '2026.3.0',
    });

    const result = await getFullDetail('kauf-bulb-7d49e0');

    expect(result?.on).toBe(true);
    expect(result?.firmwareVersion).toBe('2.00(u)');
    expect(result?.esphomeVersion).toBe('2026.3.0');
  });

  it('reports null firmware fields when the ping fails, independently of state success', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(getState).mockResolvedValue({ on: true, brightness: 55, r: 39, g: 183, b: 255 });
    vi.mocked(pingBulb).mockResolvedValue(null);

    const result = await getFullDetail('kauf-bulb-7d49e0');

    expect(result?.online).toBe(true);
    expect(result?.firmwareVersion).toBeNull();
    expect(result?.esphomeVersion).toBeNull();
  });
});

describe('setAllBulbsState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets every known bulb in parallel and reports per-bulb success', async () => {
    const bulbA = { ...STORED, id: 'a', lastIp: '1.1.1.1', objectId: 'obj_a' };
    const bulbB = { ...STORED, id: 'b', lastIp: '2.2.2.2', objectId: 'obj_b' };
    vi.mocked(listBulbs).mockReturnValue([bulbA, bulbB]);
    vi.mocked(setState).mockImplementation(async (ip: string) => ip === '1.1.1.1');

    const results = await setAllBulbsState(true);

    expect(results).toEqual([
      { id: 'a', success: true },
      { id: 'b', success: false },
    ]);
    expect(setState).toHaveBeenCalledWith('1.1.1.1', 'obj_a', { on: true });
    expect(setState).toHaveBeenCalledWith('2.2.2.2', 'obj_b', { on: true });
  });

  it('returns an empty array when there are no known bulbs', async () => {
    vi.mocked(listBulbs).mockReturnValue([]);

    expect(await setAllBulbsState(true)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/service.test.ts`
Expected: FAIL — `getFullDetail` and `setAllBulbsState` don't exist yet.

- [ ] **Step 3: Update `src/bulbs/service.ts`**

Change the import line at the top:

```typescript
import { listBulbs, getBulb, renameBulb, StoredBulb } from './store';
import { getState, setState, pingBulb, SetStateOptions } from './deviceApi';
```

Add, after the `BulbWithState` interface:

```typescript
export interface BulbDetail extends BulbWithState {
  firmwareVersion: string | null;
  esphomeVersion: string | null;
}
```

Add, at the end of the file:

```typescript
export async function getFullDetail(id: string): Promise<BulbDetail | null> {
  const stored = getBulb(id);
  if (!stored) return null;

  const [bulb, ping] = await Promise.all([withLiveState(stored), pingBulb(stored.lastIp)]);
  if (!bulb) return null;

  return {
    ...bulb,
    firmwareVersion: ping?.firmwareVersion ?? null,
    esphomeVersion: ping?.esphomeVersion ?? null,
  };
}

export async function setAllBulbsState(on: boolean): Promise<{ id: string; success: boolean }[]> {
  const stored = listBulbs();
  return Promise.all(
    stored.map(async (bulb) => {
      const success = await setState(bulb.lastIp, bulb.objectId, { on });
      return { id: bulb.id, success };
    })
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/service.test.ts`
Expected: PASS (all tests, including the new ones)

- [ ] **Step 5: Commit**

```bash
git add src/bulbs/service.ts test/service.test.ts
git commit -m "Add getFullDetail (live firmware info) and setAllBulbsState to the service layer"
```

---

## Task 3: Public API — extended GET /bulb, bulk on/off, discover

**Files:**
- Create: `src/bulbs/validation.ts`
- Modify: `src/routes/bulbs.ts`
- Modify: `test/bulbs.test.ts`

**Interfaces:**
- Consumes: `getFullDetail`, `setAllBulbsState` from Task 2 (`src/bulbs/service.ts`); `runDiscoveryScan` from `src/bulbs/discovery.ts` (already built).
- Produces: `parseSetOptions(body: Record<string, unknown>): {valid: boolean, options?: SetStateOptions}` (extracted, unchanged logic, from its current home as a private function in `src/routes/bulbs.ts`) — now shared by both route surfaces.

- [ ] **Step 1: Extract `src/bulbs/validation.ts`**

```typescript
// src/bulbs/validation.ts
import { SetStateOptions } from './deviceApi';

export function parseSetOptions(body: Record<string, unknown>): { valid: boolean; options?: SetStateOptions } {
  const options: SetStateOptions = {};

  if (body.on !== undefined) {
    if (typeof body.on !== 'boolean') return { valid: false };
    options.on = body.on;
  }

  if (body.brightness !== undefined) {
    if (typeof body.brightness !== 'number' || body.brightness < 0 || body.brightness > 100) {
      return { valid: false };
    }
    options.brightness = body.brightness;
  }

  for (const key of ['r', 'g', 'b'] as const) {
    const value = body[key];
    if (value !== undefined) {
      if (typeof value !== 'number' || value < 0 || value > 255) return { valid: false };
      options[key] = value;
    }
  }

  if (body.transition !== undefined) {
    if (typeof body.transition !== 'number' || body.transition < 0) return { valid: false };
    options.transition = body.transition;
  }

  return { valid: true, options };
}
```

This is the exact same logic as the current `parseSetBody` function already in `src/routes/bulbs.ts` — a pure extraction, not a behavior change.

- [ ] **Step 2: Write the failing tests**

In `test/bulbs.test.ts`, update the `vi.mock('../src/bulbs/service', ...)` block and its matching import to add `getFullDetail` and `setAllBulbsState`, and remove `getWithLiveState` (no longer used by this file — `GET /bulb` now calls `getFullDetail`):

```typescript
vi.mock('../src/bulbs/service', () => ({
  listWithLiveState: vi.fn(),
  getFullDetail: vi.fn(),
  setBulbState: vi.fn(),
  renameBulbAndGetState: vi.fn(),
  setAllBulbsState: vi.fn(),
}));

vi.mock('../src/bulbs/discovery', () => ({
  runDiscoveryScan: vi.fn(),
}));

import { createApp } from '../src/app';
import {
  listWithLiveState,
  getFullDetail,
  setBulbState,
  renameBulbAndGetState,
  setAllBulbsState,
} from '../src/bulbs/service';
import { runDiscoveryScan } from '../src/bulbs/discovery';
```

Add a second fixture near `SAMPLE_BULB`, for the extended `GET /bulb` shape:

```typescript
const SAMPLE_BULB_DETAIL = {
  ...SAMPLE_BULB,
  firmwareVersion: '2.00(u)',
  esphomeVersion: '2026.3.0',
};
```

In the existing `describe('GET /bulb', ...)` block, replace every `vi.mocked(getWithLiveState)` with `vi.mocked(getFullDetail)`, and change the `'returns the bulb for a known id'` test to use `SAMPLE_BULB_DETAIL`:

```typescript
  it('returns the bulb for a known id', async () => {
    vi.mocked(getFullDetail).mockResolvedValue(SAMPLE_BULB_DETAIL);
    const app = createApp();

    const response = await request(app)
      .get('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(SAMPLE_BULB_DETAIL);
  });
```

(the `'returns 404 for an unknown id'` test just needs its `vi.mocked(getWithLiveState)` renamed to `vi.mocked(getFullDetail)`, no other change.)

Add these new `describe` blocks, after the existing `describe('PUT /bulb', ...)` block and before `describe('async error boundary', ...)`:

```typescript
describe('POST /bulbs/on', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).post('/bulbs/on');
    expect(response.status).toBe(401);
  });

  it('returns per-bulb results for a valid token', async () => {
    vi.mocked(setAllBulbsState).mockResolvedValue([
      { id: 'kauf-bulb-7d49e0', success: true },
      { id: 'kauf-bulb-abc123', success: false },
    ]);
    const app = createApp();

    const response = await request(app).post('/bulbs/on').set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      results: [
        { id: 'kauf-bulb-7d49e0', success: true },
        { id: 'kauf-bulb-abc123', success: false },
      ],
    });
    expect(setAllBulbsState).toHaveBeenCalledWith(true);
  });
});

describe('POST /bulbs/off', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).post('/bulbs/off');
    expect(response.status).toBe(401);
  });

  it('calls setAllBulbsState with false', async () => {
    vi.mocked(setAllBulbsState).mockResolvedValue([]);
    const app = createApp();

    await request(app).post('/bulbs/off').set('Authorization', `Bearer ${TOKEN}`);

    expect(setAllBulbsState).toHaveBeenCalledWith(false);
  });
});

describe('POST /discover', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).post('/discover');
    expect(response.status).toBe(401);
  });

  it('runs a scan and returns the updated list', async () => {
    vi.mocked(runDiscoveryScan).mockResolvedValue(1);
    vi.mocked(listWithLiveState).mockResolvedValue([SAMPLE_BULB]);
    const app = createApp();

    const response = await request(app).post('/discover').set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bulbsFound: 1, bulbs: [SAMPLE_BULB] });
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run test/bulbs.test.ts`
Expected: FAIL — `POST /bulbs/on`, `POST /bulbs/off`, `POST /discover` don't exist yet (404 from the app's catch-all), and `GET /bulb`'s tests fail because the route still calls `getWithLiveState`, not `getFullDetail`.

- [ ] **Step 4: Update `src/routes/bulbs.ts`**

Replace the whole file:

```typescript
// src/routes/bulbs.ts
import { Router, Request, Response } from 'express';
import { requireToken } from '../middleware/requireToken';
import { asyncHandler } from '../middleware/asyncHandler';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import {
  listWithLiveState,
  getFullDetail,
  setBulbState,
  renameBulbAndGetState,
  setAllBulbsState,
} from '../bulbs/service';
import { runDiscoveryScan } from '../bulbs/discovery';
import { parseSetOptions } from '../bulbs/validation';

export const bulbsRouter = Router();
const requireBulbsToken = requireToken('BULBS_API_TOKENS');
// Reuse the existing 30-requests-per-15-minutes limiter used for the OAuth
// callback and session UI routes. This endpoint is protected by a static
// Bearer token, so the limiter's job is to bound brute-force token guessing
// and runaway/looping callers, not to support high-frequency polling -
// 30/15min (2/min) is generous for normal manual bulb control from the UI
// or occasional automation, while still capping the blast radius of a
// leaked token or malfunctioning client. Kept identical to the UI limiter
// for consistency rather than inventing a bespoke value.

bulbsRouter.get(
  '/bulbs',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const bulbs = await listWithLiveState();
    res.status(200).json({ bulbs });
  })
);

bulbsRouter.get(
  '/bulb',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.query.id;
    if (typeof id !== 'string') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const bulb = await getFullDetail(id);
    if (!bulb) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.status(200).json(bulb);
  })
);

bulbsRouter.post(
  '/bulb',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.query.id;
    if (typeof id !== 'string') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const parsed = parseSetOptions(req.body ?? {});
    if (!parsed.valid) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await setBulbState(id, parsed.options!);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    if (!result.success) {
      res.status(502).json({ error: 'bulb unreachable' });
      return;
    }

    res.status(200).json(result.bulb);
  })
);

bulbsRouter.put(
  '/bulb',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (req: Request, res: Response) => {
    const id = req.query.id;
    if (typeof id !== 'string') {
      res.status(404).json({ error: 'not found' });
      return;
    }

    const name = (req.body ?? {}).name;
    if (typeof name !== 'string' || name.length === 0) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await renameBulbAndGetState(id, name);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }

    res.status(200).json(result.bulb);
  })
);

bulbsRouter.post(
  '/bulbs/on',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const results = await setAllBulbsState(true);
    res.status(200).json({ results });
  })
);

bulbsRouter.post(
  '/bulbs/off',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const results = await setAllBulbsState(false);
    res.status(200).json({ results });
  })
);

bulbsRouter.post(
  '/discover',
  createAuthRateLimit(),
  requireBulbsToken,
  asyncHandler(async (_req: Request, res: Response) => {
    const bulbsFound = await runDiscoveryScan();
    const bulbs = await listWithLiveState();
    res.status(200).json({ bulbsFound, bulbs });
  })
);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/bulbs.test.ts`
Expected: PASS (all tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/bulbs/validation.ts src/routes/bulbs.ts test/bulbs.test.ts
git commit -m "Add POST /bulbs/on, POST /bulbs/off, POST /discover; extend GET /bulb with firmware info"
```

---

## Task 4: UI routes — detail fetch, live setter, bulk actions, discover

**Files:**
- Modify: `src/routes/index.ts`
- Modify: `test/index.test.ts`

**Interfaces:**
- Consumes: `getFullDetail`, `setBulbState`, `setAllBulbsState` from `src/bulbs/service.ts`; `runDiscoveryScan` from `src/bulbs/discovery.ts`; `parseSetOptions` from Task 3 (`src/bulbs/validation.ts`).
- Produces: `GET /ui/bulb/:id` (JSON detail); `POST /ui/bulb/:id/set` (JSON in/out); `POST /ui/bulbs/on`, `POST /ui/bulbs/off`, `POST /ui/discover` (redirect-based).

- [ ] **Step 1: Write the failing tests**

In `test/index.test.ts`, update the `vi.mock('../src/bulbs/service', ...)` block and its import, and the `beforeEach` mock resets:

```typescript
vi.mock('../src/bulbs/service', () => ({
  listWithLiveState: vi.fn(),
  getWithLiveState: vi.fn(),
  getFullDetail: vi.fn(),
  setBulbState: vi.fn(),
  setAllBulbsState: vi.fn(),
}));

vi.mock('../src/bulbs/discovery', () => ({
  runDiscoveryScan: vi.fn(),
}));

import { createApp } from '../src/app';
import { signSession } from '../src/session';
import {
  listWithLiveState,
  getWithLiveState,
  getFullDetail,
  setBulbState,
  setAllBulbsState,
} from '../src/bulbs/service';
import { runDiscoveryScan } from '../src/bulbs/discovery';

beforeEach(() => {
  vi.mocked(listWithLiveState).mockReset().mockResolvedValue([]);
  vi.mocked(getWithLiveState).mockReset();
  vi.mocked(getFullDetail).mockReset();
  vi.mocked(setBulbState).mockReset();
  vi.mocked(setAllBulbsState).mockReset();
  vi.mocked(runDiscoveryScan).mockReset();
});
```

Add these new `describe` blocks after the existing `describe('POST /ui/bulb/:id/toggle', ...)` block:

```typescript
const DETAIL_BULB = {
  id: 'kauf-bulb-7d49e0',
  name: 'Kauf Bulb 7d49e0',
  mac: 'C4:5B:BE:7D:49:E0',
  lastIp: '192.168.1.26',
  online: true,
  on: true,
  brightness: 55,
  r: 39,
  g: 183,
  b: 255,
  firmwareVersion: '2.00(u)',
  esphomeVersion: '2026.3.0',
};

describe('GET /ui/bulb/:id', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/ui/bulb/kauf-bulb-7d49e0');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('returns 404 for an unknown id', async () => {
    vi.mocked(getFullDetail).mockResolvedValue(null);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/ui/bulb/nonexistent').set('Cookie', cookie);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not found' });
  });

  it('returns the full detail JSON for a known id', async () => {
    vi.mocked(getFullDetail).mockResolvedValue(DETAIL_BULB);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/ui/bulb/kauf-bulb-7d49e0').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(DETAIL_BULB);
  });
});

describe('POST /ui/bulb/:id/set', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).post('/ui/bulb/kauf-bulb-7d49e0/set').send({ on: true });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('returns 400 for an out-of-range brightness', async () => {
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app)
      .post('/ui/bulb/kauf-bulb-7d49e0/set')
      .set('Cookie', cookie)
      .send({ brightness: 150 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid request' });
  });

  it('returns 404 for an unknown id', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: false, notFound: true });
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app)
      .post('/ui/bulb/nonexistent/set')
      .set('Cookie', cookie)
      .send({ on: true });

    expect(response.status).toBe(404);
  });

  it('returns 502 when the bulb does not respond', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: false });
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app)
      .post('/ui/bulb/kauf-bulb-7d49e0/set')
      .set('Cookie', cookie)
      .send({ on: true });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'bulb unreachable' });
  });

  it('returns the re-fetched detail on success', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: true, bulb: DETAIL_BULB });
    vi.mocked(getFullDetail).mockResolvedValue(DETAIL_BULB);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app)
      .post('/ui/bulb/kauf-bulb-7d49e0/set')
      .set('Cookie', cookie)
      .send({ brightness: 55 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(DETAIL_BULB);
    expect(setBulbState).toHaveBeenCalledWith('kauf-bulb-7d49e0', { brightness: 55 });
  });
});

describe('POST /ui/bulbs/on', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).post('/ui/bulbs/on');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('calls setAllBulbsState(true) and redirects to /', async () => {
    vi.mocked(setAllBulbsState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).post('/ui/bulbs/on').set('Cookie', cookie);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(setAllBulbsState).toHaveBeenCalledWith(true);
  });
});

describe('POST /ui/bulbs/off', () => {
  it('calls setAllBulbsState(false) and redirects to /', async () => {
    vi.mocked(setAllBulbsState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).post('/ui/bulbs/off').set('Cookie', cookie);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(setAllBulbsState).toHaveBeenCalledWith(false);
  });
});

describe('POST /ui/discover', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).post('/ui/discover');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('runs a scan and redirects to /', async () => {
    vi.mocked(runDiscoveryScan).mockResolvedValue(1);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).post('/ui/discover').set('Cookie', cookie);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(runDiscoveryScan).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — none of the five new routes exist yet.

- [ ] **Step 3: Update `src/routes/index.ts`**

Replace the whole file:

```typescript
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import { asyncHandler } from '../middleware/asyncHandler';
import { verifySession } from '../session';
import { listWithLiveState, getWithLiveState, getFullDetail, setBulbState, setAllBulbsState } from '../bulbs/service';
import { runDiscoveryScan } from '../bulbs/discovery';
import { parseSetOptions } from '../bulbs/validation';

export const indexRouter = Router();

const FAVICON_PATH = path.join(__dirname, '../../public/favicon.png');
const FAVICON = fs.readFileSync(FAVICON_PATH);

indexRouter.get('/favicon.png', (_req: Request, res: Response) => {
  res.status(200).type('image/png').send(FAVICON);
});

indexRouter.get(
  '/',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const session = verifySession(req.cookies?.session);
    const bulbs = await listWithLiveState();
    res.status(200).type('html').send(renderPage(session?.email ?? '', bulbs));
  })
);

indexRouter.get(
  '/ui/bulb/:id',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const bulb = await getFullDetail(req.params.id);
    if (!bulb) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.status(200).json(bulb);
  })
);

indexRouter.post(
  '/ui/bulb/:id/toggle',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const current = await getWithLiveState(req.params.id);
    if (current) {
      await setBulbState(req.params.id, { on: !current.on });
    }
    res.redirect(302, '/');
  })
);

indexRouter.post(
  '/ui/bulb/:id/set',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = parseSetOptions(req.body ?? {});
    if (!parsed.valid) {
      res.status(400).json({ error: 'invalid request' });
      return;
    }

    const result = await setBulbState(req.params.id, parsed.options!);

    if (result.notFound) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    if (!result.success) {
      res.status(502).json({ error: 'bulb unreachable' });
      return;
    }

    const detail = await getFullDetail(req.params.id);
    res.status(200).json(detail);
  })
);

indexRouter.post(
  '/ui/bulbs/on',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    await setAllBulbsState(true);
    res.redirect(302, '/');
  })
);

indexRouter.post(
  '/ui/bulbs/off',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    await setAllBulbsState(false);
    res.redirect(302, '/');
  })
);

indexRouter.post(
  '/ui/discover',
  createAuthRateLimit(),
  requireAuth,
  asyncHandler(async (_req: Request, res: Response) => {
    await runDiscoveryScan();
    res.redirect(302, '/');
  })
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/index.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.ts test/index.test.ts
git commit -m "Add UI detail fetch, live setter, bulk on/off, and discover routes"
```

---

## Task 5: Card grid, bulb icon, toolbar, and modal

**Files:**
- Modify: `src/views/page.ts`
- Modify: `test/index.test.ts`

**Interfaces:**
- Consumes: `BulbWithState` from `src/bulbs/service.ts` (unchanged import).
- Produces: `renderPage(email: string, bulbs: BulbWithState[]): string` — same signature, new HTML/CSS/JS output.

- [ ] **Step 1: Write the failing tests**

In `test/index.test.ts`'s `describe('GET /', ...)` block, replace the `'lists discovered bulbs with their status'` test with:

```typescript
  it('lists discovered bulbs as cards with a data-id and the toggle form', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([
      {
        id: 'kauf-bulb-7d49e0',
        name: 'Kauf Bulb 7d49e0',
        mac: 'C4:5B:BE:7D:49:E0',
        lastIp: '192.168.1.26',
        online: true,
        on: true,
        brightness: 55,
        r: 39,
        g: 183,
        b: 255,
      },
    ]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/').set('Cookie', cookie);

    expect(response.text).toContain('data-id="kauf-bulb-7d49e0"');
    expect(response.text).toContain('Kauf Bulb 7d49e0');
    expect(response.text).toContain('/ui/bulb/kauf-bulb-7d49e0/toggle');
  });

  it('includes the toolbar buttons for refresh and bulk on/off', async () => {
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/').set('Cookie', cookie);

    expect(response.text).toContain('action="/ui/discover"');
    expect(response.text).toContain('action="/ui/bulbs/on"');
    expect(response.text).toContain('action="/ui/bulbs/off"');
  });

  it('includes the modal markup', async () => {
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/').set('Cookie', cookie);

    expect(response.text).toContain('id="bulb-modal"');
    expect(response.text).toContain('id="modal-brightness"');
    expect(response.text).toContain('id="modal-color"');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — the current markup has no `data-id`, no toolbar, no modal.

- [ ] **Step 3: Replace `src/views/page.ts`**

```typescript
import { BulbWithState } from '../bulbs/service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BULB_ICON_PATH =
  'M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-2 17h4v1a2 2 0 0 1-4 0v-1z';

function renderBulbList(bulbs: BulbWithState[]): string {
  if (bulbs.length === 0) {
    return '<p id="bulbs-empty">No bulbs discovered yet.</p>';
  }

  const cards = bulbs
    .map((bulb) => {
      const statusClass = bulb.online ? (bulb.on ? 'on' : 'off') : 'offline';
      const statusText = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      const iconColor =
        bulb.online && bulb.on && bulb.r !== null ? `rgb(${bulb.r},${bulb.g},${bulb.b})` : '#999';
      return `
    <div class="bulb-card ${statusClass}" data-id="${escapeHtml(bulb.id)}">
      <svg class="bulb-icon" viewBox="0 0 24 24" style="--bulb-color: ${iconColor}"><path d="${BULB_ICON_PATH}"/></svg>
      <span class="bulb-name">${escapeHtml(bulb.name)}</span>
      <span class="bulb-status">${statusText}</span>
      <form class="bulb-toggle-form" method="POST" action="/ui/bulb/${encodeURIComponent(bulb.id)}/toggle">
        <button type="submit" ${bulb.online ? '' : 'disabled'}>${bulb.on ? 'Turn off' : 'Turn on'}</button>
      </form>
    </div>`;
    })
    .join('');

  return `<div id="bulbs-grid">${cards}</div>`;
}

export function renderPage(email: string, bulbs: BulbWithState[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Kauf Bulbs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 3rem auto; padding: 0 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    a.logout { color: #666; text-decoration: none; font-size: 0.9rem; }
    a.logout:hover { text-decoration: underline; }
    #bulbs-empty { color: #888; font-style: italic; }
    .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
    .toolbar form { margin: 0; }
    #bulbs-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
    .bulb-card { border: 1px solid #eee; border-radius: 0.5rem; padding: 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; cursor: pointer; }
    .bulb-icon { width: 48px; height: 48px; fill: var(--bulb-color, #999); transition: fill 0.2s; }
    .bulb-card.offline .bulb-icon { fill: #ccc; }
    .bulb-name { font-weight: 600; text-align: center; }
    .bulb-status { font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .bulb-card.on .bulb-status { background: #d4f7d4; color: #1a6b1a; }
    .bulb-card.off .bulb-status { background: #eee; color: #555; }
    .bulb-card.offline .bulb-status { background: #f7d4d4; color: #8b1a1a; }
    .bulb-toggle-form { margin: 0; }
    dialog#bulb-modal { border: none; border-radius: 0.5rem; padding: 1.5rem; max-width: 320px; width: 90%; }
    dialog#bulb-modal::backdrop { background: rgba(0, 0, 0, 0.4); }
    .modal-close { float: right; background: none; border: none; font-size: 1.5rem; cursor: pointer; line-height: 1; }
    #bulb-modal dl { display: grid; grid-template-columns: auto 1fr; gap: 0.25rem 0.75rem; margin: 1rem 0; }
    #bulb-modal dt { color: #666; }
    #bulb-modal label { display: block; margin: 0.75rem 0; }
    #bulb-modal input[type="range"], #bulb-modal input[type="color"] { width: 100%; }
  </style>
</head>
<body>
  <header>
    <h1>Kauf Bulbs</h1>
    <div>
      <span>${escapeHtml(email)}</span> &middot;
      <a class="logout" href="/auth/logout">Sign out</a>
    </div>
  </header>
  <div class="toolbar">
    <form method="POST" action="/ui/discover"><button type="submit">Refresh</button></form>
    <form method="POST" action="/ui/bulbs/on"><button type="submit">All On</button></form>
    <form method="POST" action="/ui/bulbs/off"><button type="submit">All Off</button></form>
  </div>
  ${renderBulbList(bulbs)}

  <dialog id="bulb-modal">
    <button type="button" class="modal-close" aria-label="Close">&times;</button>
    <h2 id="modal-name"></h2>
    <dl>
      <dt>MAC</dt><dd id="modal-mac"></dd>
      <dt>Firmware</dt><dd id="modal-firmware"></dd>
      <dt>ESPHome</dt><dd id="modal-esphome"></dd>
      <dt>Status</dt><dd id="modal-status"></dd>
    </dl>
    <button id="modal-toggle" type="button">Toggle</button>
    <label>Brightness
      <input id="modal-brightness" type="range" min="0" max="100">
    </label>
    <label>Color
      <input id="modal-color" type="color">
    </label>
  </dialog>

  <script>
  (function () {
    var grid = document.getElementById('bulbs-grid');
    var modal = document.getElementById('bulb-modal');
    var currentId = null;

    function rgbToHex(r, g, b) {
      function hex(v) { return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'); }
      return '#' + hex(r) + hex(g) + hex(b);
    }

    function hexToRgb(hex) {
      var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 255, b: 255 };
    }

    function fillModal(bulb) {
      document.getElementById('modal-name').textContent = bulb.name;
      document.getElementById('modal-mac').textContent = bulb.mac;
      document.getElementById('modal-firmware').textContent = bulb.firmwareVersion || 'unknown';
      document.getElementById('modal-esphome').textContent = bulb.esphomeVersion || 'unknown';
      document.getElementById('modal-status').textContent = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      var toggleBtn = document.getElementById('modal-toggle');
      toggleBtn.textContent = bulb.on ? 'Turn off' : 'Turn on';
      toggleBtn.disabled = !bulb.online;
      var brightnessInput = document.getElementById('modal-brightness');
      brightnessInput.value = bulb.brightness != null ? bulb.brightness : 0;
      brightnessInput.disabled = !bulb.online;
      var colorInput = document.getElementById('modal-color');
      colorInput.value = bulb.r != null ? rgbToHex(bulb.r, bulb.g, bulb.b) : '#ffffff';
      colorInput.disabled = !bulb.online;
    }

    function updateCard(bulb) {
      var card = grid.querySelector('[data-id="' + bulb.id + '"]');
      if (!card) return;
      card.className = 'bulb-card ' + (bulb.online ? (bulb.on ? 'on' : 'off') : 'offline');
      var icon = card.querySelector('.bulb-icon');
      icon.style.setProperty('--bulb-color', bulb.online && bulb.on && bulb.r != null ? 'rgb(' + bulb.r + ',' + bulb.g + ',' + bulb.b + ')' : '#999');
      card.querySelector('.bulb-status').textContent = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      var btn = card.querySelector('.bulb-toggle-form button');
      btn.textContent = bulb.on ? 'Turn off' : 'Turn on';
      btn.disabled = !bulb.online;
    }

    function openModal(id) {
      currentId = id;
      fetch('/ui/bulb/' + encodeURIComponent(id))
        .then(function (res) { return res.json(); })
        .then(function (bulb) {
          fillModal(bulb);
          modal.showModal();
        });
    }

    function submitChange(options) {
      if (!currentId) return;
      fetch('/ui/bulb/' + encodeURIComponent(currentId) + '/set', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      })
        .then(function (res) { return res.json(); })
        .then(function (bulb) {
          if (bulb && bulb.id) {
            fillModal(bulb);
            updateCard(bulb);
          }
        });
    }

    if (grid) {
      grid.addEventListener('click', function (event) {
        var card = event.target.closest('.bulb-card');
        if (!card) return;
        if (event.target.closest('.bulb-toggle-form')) return;
        openModal(card.getAttribute('data-id'));
      });
    }

    document.getElementById('modal-toggle').addEventListener('click', function () {
      var isOn = document.getElementById('modal-toggle').textContent === 'Turn off';
      submitChange({ on: !isOn });
    });

    document.getElementById('modal-brightness').addEventListener('change', function (event) {
      submitChange({ brightness: Number(event.target.value) });
    });

    document.getElementById('modal-color').addEventListener('change', function (event) {
      var rgb = hexToRgb(event.target.value);
      submitChange({ r: rgb.r, g: rgb.g, b: rgb.b });
    });

    document.querySelector('.modal-close').addEventListener('click', function () {
      modal.close();
    });
  })();
  </script>
</body>
</html>
`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/index.test.ts`
Expected: PASS (all tests, including the three new/updated ones)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/views/page.ts test/index.test.ts
git commit -m "Redesign the web UI as a responsive card grid with a detail modal"
```

---

## Task 6: Playwright E2E infrastructure and coverage

**Files:**
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `test/e2e/global-setup.ts`
- Create: `test/e2e/bulbs.spec.ts`

**Interfaces:**
- Consumes: `startMockBulb` from `test/mockBulbServer.ts` (already built); `signSession`/`COOKIE_SECRET` mechanism (same one existing Vitest route tests use to bypass real OAuth).

This task is not TDD in the usual sense — there's no "RED" state for infrastructure/config files. Write everything, then run the E2E suite and iterate until it passes for real, since this exercises the actual running app rather than mocked units.

- [ ] **Step 1: Add the `@playwright/test` devDependency and `test:e2e` script**

In `package.json`, add to `devDependencies`:

```json
    "@playwright/test": "^1.48.0",
```

and add to `scripts`:

```json
    "test:e2e": "playwright test",
```

Run: `npm install`
Expected: installs cleanly, `package-lock.json` updates.

Run: `npx playwright install --with-deps chromium`
Expected: downloads the Chromium browser Playwright needs (only Chromium — no need for Firefox/WebKit in this project).

- [ ] **Step 2: Exclude `test/e2e/**` from Vitest**

Replace `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    exclude: ['node_modules/**', 'test/e2e/**'],
  },
});
```

Run: `npm test`
Expected: still PASS, same test count as before this task — confirms Vitest doesn't pick up anything from `test/e2e/` (which doesn't exist yet at this point, but will after Step 4 — this exclude must be in place before that file exists to avoid a false pass here; re-verify again in Step 6).

- [ ] **Step 3: Write `playwright.config.ts`**

```typescript
import { defineConfig } from '@playwright/test';
import path from 'path';

const TEST_PORT = 8099;
const DATA_PATH = path.join(__dirname, '.e2e-data', 'bulbs.json');

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: require.resolve('./test/e2e/global-setup.ts'),
  timeout: 30000,
  webServer: {
    command: 'npx tsx src/server.ts',
    port: TEST_PORT,
    reuseExistingServer: false,
    env: {
      PORT: String(TEST_PORT),
      GOOGLE_CLIENT_ID: 'e2e-test-client',
      GOOGLE_CLIENT_SECRET: 'e2e-test-secret',
      GOOGLE_REDIRECT_URI: `http://localhost:${TEST_PORT}/auth/google/callback`,
      COOKIE_SECRET: 'e2e-test-cookie-secret',
      ALLOWED_EMAILS: 'e2e@example.com',
      BULBS_API_TOKENS: 'e2e-test-token',
      BULBS_DATA_PATH: DATA_PATH,
      // Yields zero scan addresses (a /32 has no usable hosts), so the
      // automatic startup discovery scan never touches the seeded fixture
      // data below or reaches out to any real network.
      BULB_SCAN_CIDR: '127.0.0.1/32',
      BULB_SCAN_INTERVAL_MS: String(24 * 60 * 60 * 1000),
    },
  },
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
  },
});
```

- [ ] **Step 4: Write `test/e2e/global-setup.ts`**

```typescript
import fs from 'fs';
import path from 'path';
import { startMockBulb } from '../mockBulbServer';

const DATA_PATH = path.join(__dirname, '..', '..', '.e2e-data', 'bulbs.json');

export default async function globalSetup(): Promise<void> {
  const mock = await startMockBulb({
    mac: 'AA:BB:CC:DD:EE:FF',
    hostname: 'kauf-bulb-e2e',
    title: 'E2E Test Bulb',
    objectId: 'kauf_bulb_e2e',
  });

  const now = new Date().toISOString();
  const seedBulb = {
    id: 'kauf-bulb-e2e',
    mac: 'AA:BB:CC:DD:EE:FF',
    objectId: 'kauf_bulb_e2e',
    name: 'E2E Test Bulb',
    firstDiscovered: now,
    lastSeen: now,
    lastIp: `127.0.0.1:${mock.port}`,
  };

  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify([seedBulb], null, 2));

  // The mock server runs in this (the Playwright CLI's) process, which
  // stays alive for the whole test run and exits when `playwright test`
  // does - its OS socket closes automatically then, so no explicit
  // teardown/stop call is needed here.
}
```

- [ ] **Step 5: Write `test/e2e/bulbs.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';

const COOKIE_SECRET = 'e2e-test-cookie-secret';

function signSessionCookie(email: string): string {
  return jwt.sign({ email }, COOKIE_SECRET, { expiresIn: '7d' });
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'session',
      value: signSessionCookie('e2e@example.com'),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ]);
});

test('renders a bulb card for the seeded bulb', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.bulb-card[data-id="kauf-bulb-e2e"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.bulb-name')).toHaveText('E2E Test Bulb');
});

test('the on/off toggle button works without JavaScript (plain form submit)', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('.bulb-card[data-id="kauf-bulb-e2e"] .bulb-toggle-form button');
  const initialText = await button.textContent();

  await Promise.all([page.waitForURL('/'), button.click()]);

  const updatedText = await page
    .locator('.bulb-card[data-id="kauf-bulb-e2e"] .bulb-toggle-form button')
    .textContent();
  expect(updatedText).not.toBe(initialText);
});

test('opens the modal on card click and shows firmware/MAC details', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  await expect(page.locator('#modal-firmware')).toHaveText('2.00(u)');
  await expect(page.locator('#modal-esphome')).toHaveText('2026.3.0');
});

test('adjusting brightness in the modal updates the card without a page reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();

  const brightnessInput = page.locator('#modal-brightness');
  await brightnessInput.fill('80');
  await brightnessInput.dispatchEvent('change');

  await expect(page.locator('#modal-status')).toHaveText('On');

  await page.locator('.modal-close').click();
  await expect(modal).toBeHidden();
});
```

- [ ] **Step 6: Run the E2E suite and iterate until it passes**

Run: `npm run test:e2e`
Expected: PASS (4 tests). If a test fails, investigate carefully — likely candidates: the `Secure` session cookie not being sent to `http://localhost` by the browser (if so, try `domain: '127.0.0.1'` consistently across `baseURL` and the cookie, or drop `secure: true` on the injected cookie only — the app's own login flow still sets it `secure: true`, this is purely about what Playwright injects for the test), or a selector not matching the actual rendered markup from Task 5 (re-check the exact class/id names in `page.ts` against what the spec queries for).

- [ ] **Step 7: Re-run the Vitest suite to confirm the exclude still holds**

Run: `npm test`
Expected: PASS, same test count as Task 5's final run — `test/e2e/*.ts` files are not picked up by Vitest now that they actually exist.

- [ ] **Step 8: Wire E2E into CI**

In `.github/workflows/build-push.yml`, insert a new step between `Install dependencies and run tests` and `Log in to ghcr.io`:

```yaml
      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Run E2E tests
        run: npm run test:e2e
```

In `.github/workflows/production-checks.yml`'s `test` job, insert the same two steps between `- run: npm test` and the end of that job (before the `codeql` job, which is unaffected).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts playwright.config.ts test/e2e/ .github/workflows/build-push.yml .github/workflows/production-checks.yml
git commit -m "Add Playwright E2E coverage for the card UI and modal, wired into CI"
```

---

## Task 7: API reference documentation

**Files:**
- Create: `docs/API.md`

- [ ] **Step 1: Write `docs/API.md`**

```markdown
# kauf-server API Reference

For external services integrating with the public bulb-control API — not
the session-cookie web UI, which is documented in the top-level `README.md`.

Base URL: `https://bulbs.skylar.technology`

Every endpoint below requires an `Authorization: Bearer <token>` header,
where `<token>` is one of this deployment's `BULBS_API_TOKENS` values
(comma-separated list — any one value works). Missing or invalid token
returns `401 {"error": "unauthorized"}`.

All endpoints are rate-limited to 30 requests per 15 minutes per client.
Exceeding it returns `429`.

## Data model

A **bulb** object, returned by `GET /bulbs`, and as the base shape of
`GET /bulb`, `POST /bulb`, and `PUT /bulb`:

| Field        | Type              | Notes                                                        |
|--------------|-------------------|----------------------------------------------------------------|
| `id`         | string            | Stable identifier, e.g. `kauf-bulb-7d49e0`. Use in `?id=` params. |
| `name`       | string            | User-editable nickname (see `PUT /bulb`).                      |
| `mac`        | string            | Device MAC address, immutable.                                 |
| `lastIp`     | string            | Last-known IP address on the LAN.                               |
| `online`     | boolean           | Whether the most recent live-state fetch succeeded.             |
| `on`         | boolean \| null   | `null` if `online` is `false`.                                  |
| `brightness` | number \| null    | 0–100. `null` if `online` is `false`.                            |
| `r`, `g`, `b`| number \| null    | 0–255 each. `null` if `online` is `false`.                       |

`GET /bulb?id=` additionally includes:

| Field             | Type            | Notes                                                     |
|-------------------|-----------------|--------------------------------------------------------------|
| `firmwareVersion` | string \| null  | Kauf firmware version (e.g. `2.00(u)`). `null` if the device didn't respond to the info request — independent of `online`. |
| `esphomeVersion`  | string \| null  | ESPHome runtime version. Same nullability rule.               |

## Endpoints

### `GET /bulbs`

List every known bulb with live state.

**Response `200`:**
```json
{
  "bulbs": [
    {
      "id": "kauf-bulb-7d49e0",
      "name": "Living Room Lamp",
      "mac": "C4:5B:BE:7D:49:E0",
      "lastIp": "192.168.1.26",
      "online": true,
      "on": true,
      "brightness": 55,
      "r": 39, "g": 183, "b": 255
    }
  ]
}
```

### `GET /bulb?id=<id>`

Get one bulb's details (bulb-object fields plus `firmwareVersion`/`esphomeVersion`).

**Response `200`:** a single bulb object (extended shape, see Data model).
**Response `404`:** `{"error": "not found"}` — unknown `id`.

### `POST /bulb?id=<id>`

Set a bulb's on/off state, brightness, and/or color.

**Body** (all fields optional):
```json
{
  "on": true,
  "brightness": 75,
  "r": 255, "g": 128, "b": 0,
  "transition": 1000
}
```

- `on`: boolean. If `false`, the bulb turns off and `brightness`/`r`/`g`/`b` are ignored — the device doesn't accept color changes alongside an off command.
- `brightness`: 0–100.
- `r`, `g`, `b`: 0–255 each.
- `transition`: milliseconds, defaults to `1000` if omitted. Pass `transition: 0` explicitly for an instant change.
- Any field you omit is left unchanged on the device. If `on` is omitted (or `true`) and the bulb was off, it turns on with whatever attributes you did supply — there's no device-level way to change brightness/color without implicitly powering on.
- The device's RGB color mode normalizes chrominance so the brightest of the three channels is always 255 — sending `{r: 10, g: 20, b: 30}` will read back rescaled (e.g. `{r: 85, g: 170, b: 255}`, same ratio, brightest channel maxed). Send colors with your intended brightest channel already at 255 for a predictable round-trip.

**Response `200`:** the updated bulb object (base shape, freshly re-fetched after the change).
**Response `400`:** `{"error": "invalid request"}` — a field outside its valid range/type.
**Response `404`:** `{"error": "not found"}` — unknown `id`.
**Response `502`:** `{"error": "bulb unreachable"}` — the bulb didn't respond to the command.

### `PUT /bulb?id=<id>`

Set a bulb's nickname (persisted; unrelated to its device state).

**Body:**
```json
{ "name": "Living Room Lamp" }
```

**Response `200`:** the updated bulb object.
**Response `400`:** `{"error": "invalid request"}` — `name` missing, not a string, or empty.
**Response `404`:** `{"error": "not found"}` — unknown `id`.

### `POST /bulbs/on`, `POST /bulbs/off`

Turn every known bulb on/off in parallel. No body.

**Response `200`:**
```json
{
  "results": [
    { "id": "kauf-bulb-7d49e0", "success": true },
    { "id": "kauf-bulb-abc123", "success": false }
  ]
}
```

Never fails the whole request for one bulb's failure — check each entry's `success`.

### `POST /discover`

Run a discovery scan immediately, rather than waiting for the automatic
20-minute interval, and return the updated list once it completes. This is
a **blocking** call — a full subnet sweep can take several seconds. No body.

**Response `200`:**
```json
{
  "bulbsFound": 1,
  "bulbs": [ /* same shape as GET /bulbs */ ]
}
```

## Examples (cURL)

```bash
TOKEN="your-token-here"
BASE="https://bulbs.skylar.technology"

# List bulbs
curl -s "$BASE/bulbs" -H "Authorization: Bearer $TOKEN"

# Get one bulb's full detail (including firmware)
curl -s "$BASE/bulb?id=kauf-bulb-7d49e0" -H "Authorization: Bearer $TOKEN"

# Turn a bulb on at 50% brightness, orange
curl -s -X POST "$BASE/bulb?id=kauf-bulb-7d49e0" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"on": true, "brightness": 50, "r": 255, "g": 128, "b": 0}'

# Rename a bulb
curl -s -X PUT "$BASE/bulb?id=kauf-bulb-7d49e0" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "Living Room Lamp"}'

# Turn everything off
curl -s -X POST "$BASE/bulbs/off" -H "Authorization: Bearer $TOKEN"

# Trigger an immediate discovery scan
curl -s -X POST "$BASE/discover" -H "Authorization: Bearer $TOKEN"
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/API.md
git commit -m "Add API reference documentation for external integrators"
```

---

## Task 8: Deploy and live verification

Operational task — no code changes. Executed directly by the controller with user confirmation before pushing to `production` (matches this session's established pattern for live deploys).

- [ ] **Step 1: Push to `main`, confirm the build (including E2E) succeeds**

```bash
git push origin HEAD:refs/heads/main
gh run watch --repo klaushofrichter/kauf-server
```

Expected: `Build and publish image` workflow passes, including the new Playwright steps.

- [ ] **Step 2: Confirm with the user, then push to `production`**

```bash
git push origin HEAD:refs/heads/production
gh run watch --repo klaushofrichter/kauf-server
```

Expected: `Deploy production` workflow passes.

- [ ] **Step 3: Live verification against the real bulb and browser**

```bash
curl -s https://bulbs.skylar.technology/health
curl -s "https://bulbs.skylar.technology/bulb?id=kauf-bulb-7d49e0" -H "Authorization: Bearer <real BULBS_API_TOKENS value>"
curl -s -X POST "https://bulbs.skylar.technology/discover" -H "Authorization: Bearer <token>"
curl -s -X POST "https://bulbs.skylar.technology/bulbs/on" -H "Authorization: Bearer <token>"
curl -s -X POST "https://bulbs.skylar.technology/bulbs/off" -H "Authorization: Bearer <token>"
```

Expected: `GET /bulb?id=` now includes real `firmwareVersion`/`esphomeVersion` values from the physical device; `POST /discover` returns the current directory; `POST /bulbs/on`/`off` report `success: true` for the real bulb — restore its prior on/off/brightness/color state afterward with a `POST /bulb?id=` call, the same way prior live-verification steps in this project have.

Then open `https://bulbs.skylar.technology/` in a browser: confirm the card grid renders, clicking a card opens the modal with real MAC/firmware/ESPHome version, adjusting the brightness slider and color picker updates the bulb and the card live without a page reload, the plain on/off button on the card still works, and the "Refresh"/"All On"/"All Off" toolbar buttons work.

---

## Self-Review Notes

- **Spec coverage:** firmware/MAC exposure (Tasks 1–2), bulk on/off + manual discovery as both API and UI surfaces (Tasks 3–4), card grid + modal + vanilla JS (Task 5), Playwright E2E + CI wiring (Task 6), API documentation (Task 7), live deploy verification (Task 8) — every spec section and both mid-brainstorm amendments (CI wiring, API docs) have a task.
- **Placeholder scan:** no TBD/TODO. The only bracketed placeholders (`<real BULBS_API_TOKENS value>`, `<token>`) are in Task 8's operational curl commands, matching every prior phase's pattern for live-verification steps.
- **Type consistency:** `BulbDetail` (Task 2) used identically by `GET /bulb` (Task 3) and `GET /ui/bulb/:id`/`POST /ui/bulb/:id/set` (Task 4). `parseSetOptions` (Task 3, extracted to `src/bulbs/validation.ts`) has the identical signature and is imported unchanged by both `src/routes/bulbs.ts` (Task 3) and `src/routes/index.ts` (Task 4) — no duplicated validation logic. `renderPage`'s signature is unchanged from the prior phase, so no caller elsewhere needs updating. `setAllBulbsState`'s return shape (`{id, success}[]`) is used identically by the public `POST /bulbs/on`/`off` (Task 3, wrapped in `{results: [...]}`) and the UI `POST /ui/bulbs/on`/`off` (Task 4, result discarded, just triggers a redirect).
