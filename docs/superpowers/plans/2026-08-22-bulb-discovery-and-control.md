# Bulb Discovery, Persistence, and Control API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover Kauf smart bulbs on the local network via a periodic HTTP subnet scan, persist a directory of them across restarts on a PVC, and expose a Bearer-token-protected REST API plus a minimal web UI to read status and turn bulbs on/off.

**Architecture:** A new `src/bulbs/` domain module (device HTTP client, JSON-file store, discovery scanner, and a service layer composing them) sits behind two HTTP surfaces: the existing public Bearer-token API (`src/routes/bulbs.ts`) and the existing session-cookie web UI (`src/routes/index.ts`). An in-process timer runs discovery on startup and every 20 minutes — no separate Kubernetes CronJob, since the ksvc already runs a single always-on replica.

**Tech Stack:** Node 20 built-in `fetch`/`ReadableStream` (no new dependencies), TypeScript, Express, Vitest + Supertest (device I/O mocked in every test — nothing touches the real network in CI).

**Spec:** `docs/superpowers/specs/2026-08-22-bulb-discovery-and-control-design.md`

## Global Constraints

- Bulb `id` = the device's own reported `hostname` from the SSE `ping` frame (e.g. `kauf-bulb-7d49e0`).
- A bulb's light-entity `objectId` = its SSE `state` frame's `id` field with the `light-` prefix stripped (e.g. `light-kauf_bulb_7d49e0` → `kauf_bulb_7d49e0`). Looked up once at first discovery, persisted, never re-derived.
- Kauf-bulb signature for discovery: the `ping` frame's `proj_n` field equals exactly `Kauf.RGBWW`.
- Brightness: our API and persisted/live-state values are 0–100 (percent); the device API is 0–255. Convert with `Math.round((percent / 100) * 255)` (our→device) and `Math.round((raw / 255) * 100)` (device→our).
- Transition: our API is milliseconds, default `1000` when omitted; the device API is seconds. Convert with `ms / 1000`.
- `r`, `g`, `b` are 0–255 in both our API and the device API — no conversion.
- `BULB_SCAN_CIDR` (default `192.168.1.0/24`), `BULBS_DATA_PATH` (default `/data/bulbs.json`), `BULB_SCAN_INTERVAL_MS` (default `1200000` = 20 min) are read directly via `process.env.X || default` inline in the modules that use them — they are NOT added to `assertRequiredEnv`'s required list (they have sane defaults; they aren't secrets).
- Discovery is an in-process `setInterval` started from `src/server.ts` after the app starts listening — no Kubernetes CronJob, no separate pod, no PVC-sharing across pods.
- Persisted bulb fields `id`, `mac`, `objectId`, `firstDiscovered` are written once and never modified after creation. `lastSeen`, `lastIp` update on every successful scan. A bulb not seen in a scan is kept (never deleted) and reported `online: false`.
- `GET /bulbs` and `GET /bulb?id=` always fetch current on/off/brightness/color live from the device — the persisted file never stores that state.
- Public API routes (`GET /bulbs`, `GET /bulb`, `POST /bulb`) are gated by the existing `requireToken('BULBS_API_TOKENS')` middleware. The UI action route (`POST /ui/bulb/:id/toggle`) is gated by the existing `requireAuth` session-cookie middleware — a structurally separate surface so the browser never needs the API token.
- `express.json()` must be present in `src/app.ts` (it was removed in the skeleton phase's final-review fix wave because nothing needed it then — `POST /bulb` and the toggle route now do).

---

## Task 1: Device API client

**Files:**
- Create: `src/bulbs/deviceApi.ts`
- Test: `test/deviceApi.test.ts`

**Interfaces:**
- Produces: `pingBulb(ip: string): Promise<PingResult | null>` where `PingResult = {mac: string, hostname: string, title: string}`; `findLightEntity(ip: string): Promise<string | null>` (returns an `objectId` or null); `getState(ip: string, objectId: string): Promise<DeviceState | null>` where `DeviceState = {on: boolean, brightness: number | null, r: number | null, g: number | null, b: number | null}`; `setState(ip: string, objectId: string, options: SetStateOptions): Promise<boolean>` where `SetStateOptions = {on?: boolean, brightness?: number, r?: number, g?: number, b?: number, transition?: number}`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/deviceApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pingBulb, findLightEntity, getState, setState } from '../src/bulbs/deviceApi';

function sseResponse(text: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

const PING_FRAME =
  'event: ping\ndata: {"title":"Kauf Bulb 7d49e0","esph_v":"2026.3.0","proj_n":"Kauf.RGBWW","proj_v":"2.00(u)","mac_addr":"C4:5B:BE:7D:49:E0","hostname":"kauf-bulb-7d49e0"}\n\n';

const NON_KAUF_PING_FRAME =
  'event: ping\ndata: {"title":"Some Other Device","proj_n":"SomethingElse"}\n\n';

const STATE_FRAMES =
  'event: state\ndata: {"name_id":"binary_sensor/4MiB","id":"binary_sensor-4mib","domain":"binary_sensor","entity_category":2}\n\n' +
  'event: state\ndata: {"name_id":"light/Warm RGB","id":"light-warm_rgb","domain":"light","entity_category":1}\n\n' +
  'event: state\ndata: {"name_id":"light/Cold RGB","id":"light-cold_rgb","domain":"light","entity_category":1}\n\n' +
  'event: state\ndata: {"name_id":"light/Kauf Bulb 7d49e0","id":"light-kauf_bulb_7d49e0","domain":"light","state":"ON","brightness":140,"color":{"r":39,"g":183,"b":255}}\n\n';

describe('pingBulb', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('returns device identity for a genuine Kauf bulb', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(PING_FRAME));

    const result = await pingBulb('192.168.1.26');

    expect(result).toEqual({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
    });
  });

  it('returns null when proj_n does not match the Kauf signature', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(NON_KAUF_PING_FRAME));

    expect(await pingBulb('192.168.1.50')).toBeNull();
  });

  it('returns null when the connection fails', async () => {
    (global.fetch as any).mockRejectedValue(new Error('connection refused'));

    expect(await pingBulb('192.168.1.99')).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse('', 404));

    expect(await pingBulb('192.168.1.99')).toBeNull();
  });
});

describe('findLightEntity', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('finds the primary light entity and skips hidden config lights', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(PING_FRAME + STATE_FRAMES));

    expect(await findLightEntity('192.168.1.26')).toBe('kauf_bulb_7d49e0');
  });

  it('returns null when no matching light entity appears', async () => {
    (global.fetch as any).mockResolvedValue(sseResponse(PING_FRAME));

    expect(await findLightEntity('192.168.1.26')).toBeNull();
  });
});

describe('getState', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  it('converts device state to our API shape', async () => {
    (global.fetch as any).mockResolvedValue(
      new Response(JSON.stringify({ state: 'ON', brightness: 140, color: { r: 39, g: 183, b: 255 } }), {
        status: 200,
      })
    );

    expect(await getState('192.168.1.26', 'kauf_bulb_7d49e0')).toEqual({
      on: true,
      brightness: 55,
      r: 39,
      g: 183,
      b: 255,
    });
  });

  it('returns null when the bulb does not respond', async () => {
    (global.fetch as any).mockRejectedValue(new Error('timeout'));

    expect(await getState('192.168.1.26', 'kauf_bulb_7d49e0')).toBeNull();
  });
});

describe('setState', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  });

  it('calls turn_off when on is false', async () => {
    const success = await setState('192.168.1.26', 'kauf_bulb_7d49e0', { on: false });

    expect(success).toBe(true);
    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/light/kauf_bulb_7d49e0/turn_off');
    expect(calledUrl).toContain('transition=1');
  });

  it('calls turn_on with only the provided attributes', async () => {
    await setState('192.168.1.26', 'kauf_bulb_7d49e0', { brightness: 50 });

    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/light/kauf_bulb_7d49e0/turn_on');
    expect(calledUrl).toContain('brightness=128');
    expect(calledUrl).not.toContain('r=');
  });

  it('defaults transition to 1000ms (1 second) when omitted', async () => {
    await setState('192.168.1.26', 'kauf_bulb_7d49e0', { on: true });

    const calledUrl = (global.fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('transition=1');
  });

  it('returns false when the device call fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));

    expect(await setState('192.168.1.26', 'kauf_bulb_7d49e0', { on: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/deviceApi.test.ts`
Expected: FAIL — `src/bulbs/deviceApi.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/bulbs/deviceApi.ts
const PING_TIMEOUT_MS = 800;
const ENTITY_TIMEOUT_MS = 2000;
const STATE_TIMEOUT_MS = 3000;
const KAUF_PROJECT_NAME = 'Kauf.RGBWW';

export interface PingResult {
  mac: string;
  hostname: string;
  title: string;
}

export interface DeviceState {
  on: boolean;
  brightness: number | null;
  r: number | null;
  g: number | null;
  b: number | null;
}

export interface SetStateOptions {
  on?: boolean;
  brightness?: number;
  r?: number;
  g?: number;
  b?: number;
  transition?: number;
}

async function readSseFrames(
  ip: string,
  timeoutMs: number,
  onFrame: (event: string, data: string) => boolean
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${ip}/events`, {
      signal: controller.signal,
      headers: { Accept: 'text/event-stream' },
    });

    if (!response.ok || !response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        let frameEnd;
        while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);

          const eventMatch = frame.match(/event:\s*(\S+)/);
          const dataMatch = frame.match(/data:\s*(.+)/);
          if (eventMatch && dataMatch) {
            const shouldStop = onFrame(eventMatch[1], dataMatch[1]);
            if (shouldStop) {
              await reader.cancel();
              return;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } catch {
    // Timeout, connection refused, or any network error - caller sees no result.
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function pingBulb(ip: string): Promise<PingResult | null> {
  let result: PingResult | null = null;

  await readSseFrames(ip, PING_TIMEOUT_MS, (event, data) => {
    if (event !== 'ping') return false;
    try {
      const parsed = JSON.parse(data);
      if (parsed.proj_n === KAUF_PROJECT_NAME) {
        result = {
          mac: parsed.mac_addr,
          hostname: parsed.hostname,
          title: parsed.title,
        };
      }
    } catch {
      // Malformed ping frame - not a match.
    }
    return true; // Ping is always the first frame; stop after it either way.
  });

  return result;
}

export async function findLightEntity(ip: string): Promise<string | null> {
  let objectId: string | null = null;

  await readSseFrames(ip, ENTITY_TIMEOUT_MS, (event, data) => {
    if (event !== 'state') return false;
    try {
      const parsed = JSON.parse(data);
      if (parsed.domain === 'light' && parsed.entity_category !== 1 && typeof parsed.id === 'string') {
        objectId = parsed.id.replace(/^light-/, '');
        return true;
      }
    } catch {
      // Malformed state frame - keep reading.
    }
    return false;
  });

  return objectId;
}

export async function getState(ip: string, objectId: string): Promise<DeviceState | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);

  try {
    const response = await fetch(`http://${ip}/light/${objectId}`, { signal: controller.signal });
    if (!response.ok) return null;

    const data = await response.json();
    return {
      on: data.state === 'ON',
      brightness: typeof data.brightness === 'number' ? Math.round((data.brightness / 255) * 100) : null,
      r: data.color?.r ?? null,
      g: data.color?.g ?? null,
      b: data.color?.b ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function setState(ip: string, objectId: string, options: SetStateOptions): Promise<boolean> {
  const params = new URLSearchParams();
  const transitionMs = options.transition ?? 1000;
  params.set('transition', (transitionMs / 1000).toString());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STATE_TIMEOUT_MS);

  try {
    let url: string;
    if (options.on === false) {
      url = `http://${ip}/light/${objectId}/turn_off?${params.toString()}`;
    } else {
      if (options.brightness !== undefined) {
        params.set('brightness', Math.round((options.brightness / 100) * 255).toString());
      }
      if (options.r !== undefined) params.set('r', options.r.toString());
      if (options.g !== undefined) params.set('g', options.g.toString());
      if (options.b !== undefined) params.set('b', options.b.toString());
      url = `http://${ip}/light/${objectId}/turn_on?${params.toString()}`;
    }

    const response = await fetch(url, { method: 'POST', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/deviceApi.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bulbs/deviceApi.ts test/deviceApi.test.ts
git commit -m "Add ESPHome device API client for Kauf bulbs"
```

---

## Task 2: Bulb directory persistence

**Files:**
- Create: `src/bulbs/store.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Produces: `StoredBulb = {id, mac, objectId, name, firstDiscovered, lastSeen, lastIp}` (all `string`); `loadBulbs(): StoredBulb[]`; `saveBulbs(bulbs: StoredBulb[]): void`; `upsertBulb(info: {mac: string, hostname: string, title: string, ip: string, objectId?: string}): StoredBulb` (updates an existing bulb by `mac`, or creates one — throws if creating and `objectId` is missing); `getBulb(id: string): StoredBulb | null`; `listBulbs(): StoredBulb[]` (alias for `loadBulbs`).

- [ ] **Step 1: Write the failing tests**

```typescript
// test/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadBulbs, upsertBulb, getBulb } from '../src/bulbs/store';

describe('bulbs store', () => {
  let dataPath: string;

  beforeEach(() => {
    dataPath = path.join(os.tmpdir(), `bulbs-test-${Date.now()}-${Math.random()}.json`);
    process.env.BULBS_DATA_PATH = dataPath;
  });

  afterEach(() => {
    if (fs.existsSync(dataPath)) fs.unlinkSync(dataPath);
    delete process.env.BULBS_DATA_PATH;
  });

  it('returns an empty array when the file does not exist', () => {
    expect(loadBulbs()).toEqual([]);
  });

  it('creates a new bulb with immutable fields set', () => {
    const created = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    expect(created.id).toBe('kauf-bulb-7d49e0');
    expect(created.mac).toBe('C4:5B:BE:7D:49:E0');
    expect(created.objectId).toBe('kauf_bulb_7d49e0');
    expect(created.firstDiscovered).toBe(created.lastSeen);
    expect(loadBulbs()).toHaveLength(1);
  });

  it('throws when creating a new bulb without objectId', () => {
    expect(() => upsertBulb({ mac: 'AA:BB', hostname: 'x', title: 'x', ip: '1.2.3.4' })).toThrow();
  });

  it('updates lastSeen and lastIp for an existing bulb without touching immutable fields', async () => {
    const first = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.99',
    });

    expect(updated.id).toBe(first.id);
    expect(updated.objectId).toBe(first.objectId);
    expect(updated.firstDiscovered).toBe(first.firstDiscovered);
    expect(updated.lastIp).toBe('192.168.1.99');
    expect(updated.lastSeen).not.toBe(first.lastSeen);
    expect(loadBulbs()).toHaveLength(1);
  });

  it('getBulb returns null for an unknown id', () => {
    expect(getBulb('nonexistent')).toBeNull();
  });

  it('getBulb finds a known bulb by id', () => {
    upsertBulb({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.26',
      objectId: 'kauf_bulb_7d49e0',
    });

    expect(getBulb('kauf-bulb-7d49e0')?.mac).toBe('C4:5B:BE:7D:49:E0');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/store.test.ts`
Expected: FAIL — `src/bulbs/store.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/bulbs/store.ts
import fs from 'fs';
import path from 'path';

export interface StoredBulb {
  id: string;
  mac: string;
  objectId: string;
  name: string;
  firstDiscovered: string;
  lastSeen: string;
  lastIp: string;
}

interface UpsertInfo {
  mac: string;
  hostname: string;
  title: string;
  ip: string;
  objectId?: string;
}

function getDataPath(): string {
  return process.env.BULBS_DATA_PATH || '/data/bulbs.json';
}

export function loadBulbs(): StoredBulb[] {
  const filePath = getDataPath();
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

export const listBulbs = loadBulbs;

export function saveBulbs(bulbs: StoredBulb[]): void {
  const filePath = getDataPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(bulbs, null, 2));
}

export function upsertBulb(info: UpsertInfo): StoredBulb {
  const bulbs = loadBulbs();
  const now = new Date().toISOString();
  const existing = bulbs.find((b) => b.mac === info.mac);

  if (existing) {
    existing.lastSeen = now;
    existing.lastIp = info.ip;
    saveBulbs(bulbs);
    return existing;
  }

  if (!info.objectId) {
    throw new Error(`Cannot create new bulb ${info.mac} without an objectId`);
  }

  const created: StoredBulb = {
    id: info.hostname,
    mac: info.mac,
    objectId: info.objectId,
    name: info.title,
    firstDiscovered: now,
    lastSeen: now,
    lastIp: info.ip,
  };
  bulbs.push(created);
  saveBulbs(bulbs);
  return created;
}

export function getBulb(id: string): StoredBulb | null {
  return loadBulbs().find((b) => b.id === id) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/store.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bulbs/store.ts test/store.test.ts
git commit -m "Add persistent JSON-file bulb directory store"
```

---

## Task 3: Discovery scanner

**Files:**
- Create: `src/bulbs/discovery.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Consumes: `pingBulb`, `findLightEntity` from Task 1 (`src/bulbs/deviceApi.ts`); `loadBulbs`, `upsertBulb` from Task 2 (`src/bulbs/store.ts`).
- Produces: `listCidrAddresses(cidr: string): string[]`; `runDiscoveryScan(cidr?: string): Promise<number>` (returns count of bulbs found, defaults to `BULB_SCAN_CIDR` env var or `192.168.1.0/24`); `startDiscoveryLoop(): void`; `stopDiscoveryLoop(): void`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/discovery.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/bulbs/deviceApi', () => ({
  pingBulb: vi.fn(),
  findLightEntity: vi.fn(),
}));
vi.mock('../src/bulbs/store', () => ({
  loadBulbs: vi.fn(),
  upsertBulb: vi.fn(),
}));

import { pingBulb, findLightEntity } from '../src/bulbs/deviceApi';
import { loadBulbs, upsertBulb } from '../src/bulbs/store';
import { runDiscoveryScan, listCidrAddresses } from '../src/bulbs/discovery';

describe('listCidrAddresses', () => {
  it('lists usable host addresses for a /30, excluding network and broadcast', () => {
    expect(listCidrAddresses('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('lists 254 addresses for a /24', () => {
    const addresses = listCidrAddresses('192.168.1.0/24');
    expect(addresses).toHaveLength(254);
    expect(addresses[0]).toBe('192.168.1.1');
    expect(addresses[253]).toBe('192.168.1.254');
  });
});

describe('runDiscoveryScan', () => {
  beforeEach(() => {
    vi.mocked(loadBulbs).mockReturnValue([]);
    vi.mocked(pingBulb).mockResolvedValue(null);
    vi.mocked(findLightEntity).mockResolvedValue(null);
    vi.mocked(upsertBulb).mockClear();
  });

  it('does not upsert anything when no IP responds', async () => {
    const count = await runDiscoveryScan('192.168.1.0/30');

    expect(count).toBe(0);
    expect(upsertBulb).not.toHaveBeenCalled();
  });

  it('looks up the light entity and upserts a new bulb with objectId', async () => {
    vi.mocked(pingBulb).mockImplementation(async (ip: string) =>
      ip === '192.168.1.1'
        ? { mac: 'C4:5B:BE:7D:49:E0', hostname: 'kauf-bulb-7d49e0', title: 'Kauf Bulb 7d49e0' }
        : null
    );
    vi.mocked(findLightEntity).mockResolvedValue('kauf_bulb_7d49e0');

    const count = await runDiscoveryScan('192.168.1.0/30');

    expect(count).toBe(1);
    expect(findLightEntity).toHaveBeenCalledWith('192.168.1.1');
    expect(upsertBulb).toHaveBeenCalledWith({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.1',
      objectId: 'kauf_bulb_7d49e0',
    });
  });

  it('skips the light-entity lookup for an already-known bulb', async () => {
    vi.mocked(loadBulbs).mockReturnValue([
      {
        id: 'kauf-bulb-7d49e0',
        mac: 'C4:5B:BE:7D:49:E0',
        objectId: 'kauf_bulb_7d49e0',
        name: 'x',
        firstDiscovered: 'x',
        lastSeen: 'x',
        lastIp: 'x',
      },
    ]);
    vi.mocked(pingBulb).mockImplementation(async (ip: string) =>
      ip === '192.168.1.1'
        ? { mac: 'C4:5B:BE:7D:49:E0', hostname: 'kauf-bulb-7d49e0', title: 'Kauf Bulb 7d49e0' }
        : null
    );

    await runDiscoveryScan('192.168.1.0/30');

    expect(findLightEntity).not.toHaveBeenCalled();
    expect(upsertBulb).toHaveBeenCalledWith({
      mac: 'C4:5B:BE:7D:49:E0',
      hostname: 'kauf-bulb-7d49e0',
      title: 'Kauf Bulb 7d49e0',
      ip: '192.168.1.1',
    });
  });

  it('does not upsert a new bulb if the light entity cannot be found', async () => {
    vi.mocked(pingBulb).mockImplementation(async (ip: string) =>
      ip === '192.168.1.1'
        ? { mac: 'C4:5B:BE:7D:49:E0', hostname: 'kauf-bulb-7d49e0', title: 'Kauf Bulb 7d49e0' }
        : null
    );
    vi.mocked(findLightEntity).mockResolvedValue(null);

    await runDiscoveryScan('192.168.1.0/30');

    expect(upsertBulb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/discovery.test.ts`
Expected: FAIL — `src/bulbs/discovery.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/bulbs/discovery.ts
import { pingBulb, findLightEntity } from './deviceApi';
import { loadBulbs, upsertBulb } from './store';

const SCAN_CONCURRENCY = 40;

function getCidr(): string {
  return process.env.BULB_SCAN_CIDR || '192.168.1.0/24';
}

function getIntervalMs(): number {
  return Number(process.env.BULB_SCAN_INTERVAL_MS) || 20 * 60 * 1000;
}

export function listCidrAddresses(cidr: string): string[] {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const baseParts = base.split('.').map(Number);
  const baseInt = (baseParts[0] << 24) | (baseParts[1] << 16) | (baseParts[2] << 8) | baseParts[3];
  const hostBits = 32 - prefix;
  const numHosts = Math.pow(2, hostBits);
  const networkInt = baseInt & (~0 << hostBits);

  const addresses: string[] = [];
  for (let offset = 1; offset < numHosts - 1; offset++) {
    const ipInt = networkInt + offset;
    addresses.push(
      [(ipInt >>> 24) & 255, (ipInt >>> 16) & 255, (ipInt >>> 8) & 255, ipInt & 255].join('.')
    );
  }
  return addresses;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    const current = index++;
    if (current >= items.length) return;
    await worker(items[current]);
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => next()));
}

export async function runDiscoveryScan(cidr: string = getCidr()): Promise<number> {
  const addresses = listCidrAddresses(cidr);
  const knownMacs = new Set(loadBulbs().map((b) => b.mac));
  let foundCount = 0;

  await runWithConcurrency(addresses, SCAN_CONCURRENCY, async (ip) => {
    const ping = await pingBulb(ip);
    if (!ping) return;

    foundCount++;

    if (knownMacs.has(ping.mac)) {
      upsertBulb({ mac: ping.mac, hostname: ping.hostname, title: ping.title, ip });
      return;
    }

    const objectId = await findLightEntity(ip);
    if (!objectId) return;

    upsertBulb({ mac: ping.mac, hostname: ping.hostname, title: ping.title, ip, objectId });
  });

  return foundCount;
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startDiscoveryLoop(): void {
  if (intervalHandle) return;
  runDiscoveryScan().catch((error) => console.error('Discovery scan failed:', error));
  intervalHandle = setInterval(() => {
    runDiscoveryScan().catch((error) => console.error('Discovery scan failed:', error));
  }, getIntervalMs());
}

export function stopDiscoveryLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/discovery.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bulbs/discovery.ts test/discovery.test.ts
git commit -m "Add HTTP subnet-scan bulb discovery"
```

---

## Task 4: Service layer (live state composition)

**Files:**
- Create: `src/bulbs/service.ts`
- Test: `test/service.test.ts`

**Interfaces:**
- Consumes: `listBulbs`, `getBulb` from Task 2 (`src/bulbs/store.ts`); `getState`, `setState`, `SetStateOptions` from Task 1 (`src/bulbs/deviceApi.ts`).
- Produces: `BulbWithState = {id, name, mac, lastIp, online: boolean, on: boolean | null, brightness: number | null, r: number | null, g: number | null, b: number | null}`; `listWithLiveState(): Promise<BulbWithState[]>`; `getWithLiveState(id: string): Promise<BulbWithState | null>`; `setBulbState(id: string, options: SetStateOptions): Promise<{success: boolean, notFound?: boolean, bulb?: BulbWithState}>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// test/service.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/bulbs/store', () => ({
  listBulbs: vi.fn(),
  getBulb: vi.fn(),
}));
vi.mock('../src/bulbs/deviceApi', () => ({
  getState: vi.fn(),
  setState: vi.fn(),
}));

import { listBulbs, getBulb } from '../src/bulbs/store';
import { getState, setState } from '../src/bulbs/deviceApi';
import { listWithLiveState, getWithLiveState, setBulbState } from '../src/bulbs/service';

const STORED = {
  id: 'kauf-bulb-7d49e0',
  mac: 'C4:5B:BE:7D:49:E0',
  objectId: 'kauf_bulb_7d49e0',
  name: 'Kauf Bulb 7d49e0',
  firstDiscovered: '2026-01-01T00:00:00.000Z',
  lastSeen: '2026-01-01T00:00:00.000Z',
  lastIp: '192.168.1.26',
};

describe('listWithLiveState', () => {
  it('merges persisted identity with live state', async () => {
    vi.mocked(listBulbs).mockReturnValue([STORED]);
    vi.mocked(getState).mockResolvedValue({ on: true, brightness: 55, r: 39, g: 183, b: 255 });

    const result = await listWithLiveState();

    expect(result).toEqual([
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
  });

  it('reports a non-responding bulb as offline with null state', async () => {
    vi.mocked(listBulbs).mockReturnValue([STORED]);
    vi.mocked(getState).mockResolvedValue(null);

    const result = await listWithLiveState();

    expect(result[0].online).toBe(false);
    expect(result[0].on).toBeNull();
    expect(result[0].brightness).toBeNull();
  });
});

describe('getWithLiveState', () => {
  it('returns null for an unknown id', async () => {
    vi.mocked(getBulb).mockReturnValue(null);

    expect(await getWithLiveState('nonexistent')).toBeNull();
  });

  it('returns the merged bulb for a known id', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(getState).mockResolvedValue({ on: false, brightness: null, r: null, g: null, b: null });

    const result = await getWithLiveState('kauf-bulb-7d49e0');

    expect(result?.online).toBe(true);
    expect(result?.on).toBe(false);
  });
});

describe('setBulbState', () => {
  it('reports notFound for an unknown id', async () => {
    vi.mocked(getBulb).mockReturnValue(null);

    expect(await setBulbState('nonexistent', { on: true })).toEqual({ success: false, notFound: true });
  });

  it('reports failure when the device does not respond', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(setState).mockResolvedValue(false);

    expect(await setBulbState('kauf-bulb-7d49e0', { on: true })).toEqual({ success: false });
  });

  it('returns the re-fetched state on success', async () => {
    vi.mocked(getBulb).mockReturnValue(STORED);
    vi.mocked(setState).mockResolvedValue(true);
    vi.mocked(getState).mockResolvedValue({ on: true, brightness: 100, r: 255, g: 0, b: 0 });

    const result = await setBulbState('kauf-bulb-7d49e0', {
      on: true,
      brightness: 100,
      r: 255,
      g: 0,
      b: 0,
    });

    expect(result.success).toBe(true);
    expect(result.bulb?.on).toBe(true);
    expect(setState).toHaveBeenCalledWith('192.168.1.26', 'kauf_bulb_7d49e0', {
      on: true,
      brightness: 100,
      r: 255,
      g: 0,
      b: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/service.test.ts`
Expected: FAIL — `src/bulbs/service.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
// src/bulbs/service.ts
import { listBulbs, getBulb, StoredBulb } from './store';
import { getState, setState, SetStateOptions } from './deviceApi';

export interface BulbWithState {
  id: string;
  name: string;
  mac: string;
  lastIp: string;
  online: boolean;
  on: boolean | null;
  brightness: number | null;
  r: number | null;
  g: number | null;
  b: number | null;
}

async function withLiveState(stored: StoredBulb | null): Promise<BulbWithState | null> {
  if (!stored) return null;

  const state = await getState(stored.lastIp, stored.objectId);

  return {
    id: stored.id,
    name: stored.name,
    mac: stored.mac,
    lastIp: stored.lastIp,
    online: state !== null,
    on: state?.on ?? null,
    brightness: state?.brightness ?? null,
    r: state?.r ?? null,
    g: state?.g ?? null,
    b: state?.b ?? null,
  };
}

export async function listWithLiveState(): Promise<BulbWithState[]> {
  const stored = listBulbs();
  const results = await Promise.all(stored.map((bulb) => withLiveState(bulb)));
  return results.filter((b): b is BulbWithState => b !== null);
}

export async function getWithLiveState(id: string): Promise<BulbWithState | null> {
  return withLiveState(getBulb(id));
}

export async function setBulbState(
  id: string,
  options: SetStateOptions
): Promise<{ success: boolean; notFound?: boolean; bulb?: BulbWithState }> {
  const stored = getBulb(id);
  if (!stored) {
    return { success: false, notFound: true };
  }

  const success = await setState(stored.lastIp, stored.objectId, options);
  if (!success) {
    return { success: false };
  }

  const bulb = await withLiveState(stored);
  return { success: true, bulb: bulb ?? undefined };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/service.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/bulbs/service.ts test/service.test.ts
git commit -m "Add bulb service layer composing store and live device state"
```

---

## Task 5: Public API routes

**Files:**
- Modify: `src/routes/bulbs.ts` (currently the skeleton-phase stub)
- Modify: `src/app.ts` (re-add `express.json()`, removed in the skeleton phase's final-review fix wave when nothing needed it — `POST /bulb` needs a JSON body now)
- Modify: `test/bulbs.test.ts` (currently tests the stub)

**Interfaces:**
- Consumes: `requireToken` from `src/middleware/requireToken.ts` (unchanged); `listWithLiveState`, `getWithLiveState`, `setBulbState` from Task 4 (`src/bulbs/service.ts`).
- Produces: `bulbsRouter: Router` — `GET /bulbs`, `GET /bulb`, `POST /bulb`, all `requireToken('BULBS_API_TOKENS')`.

- [ ] **Step 1: Write the failing tests** (replaces the existing stub test file)

```typescript
// test/bulbs.test.ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/bulbs/service', () => ({
  listWithLiveState: vi.fn(),
  getWithLiveState: vi.fn(),
  setBulbState: vi.fn(),
}));

import { createApp } from '../src/app';
import { listWithLiveState, getWithLiveState, setBulbState } from '../src/bulbs/service';

const TOKEN = 'test-bulbs-token';
const SAMPLE_BULB = {
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
};

describe('GET /bulbs', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).get('/bulbs');
    expect(response.status).toBe(401);
  });

  it('returns the live bulb list for a valid token', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([SAMPLE_BULB]);
    const app = createApp();

    const response = await request(app).get('/bulbs').set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ bulbs: [SAMPLE_BULB] });
  });
});

describe('GET /bulb', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).get('/bulb?id=kauf-bulb-7d49e0');
    expect(response.status).toBe(401);
  });

  it('returns 404 for an unknown id', async () => {
    vi.mocked(getWithLiveState).mockResolvedValue(null);
    const app = createApp();

    const response = await request(app)
      .get('/bulb?id=nonexistent')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not found' });
  });

  it('returns the bulb for a known id', async () => {
    vi.mocked(getWithLiveState).mockResolvedValue(SAMPLE_BULB);
    const app = createApp();

    const response = await request(app)
      .get('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(SAMPLE_BULB);
  });
});

describe('POST /bulb', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).post('/bulb?id=kauf-bulb-7d49e0').send({ on: true });
    expect(response.status).toBe(401);
  });

  it('returns 400 for an out-of-range brightness', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ brightness: 150 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid request' });
  });

  it('returns 400 for an out-of-range rgb value', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ r: 300 });

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown id', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: false, notFound: true });
    const app = createApp();

    const response = await request(app)
      .post('/bulb?id=nonexistent')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ on: true });

    expect(response.status).toBe(404);
  });

  it('returns 502 when the bulb does not respond', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: false });
    const app = createApp();

    const response = await request(app)
      .post('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ on: true });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'bulb unreachable' });
  });

  it('returns 200 with the updated state on success', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: true, bulb: SAMPLE_BULB });
    const app = createApp();

    const response = await request(app)
      .post('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ on: true, brightness: 55 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(SAMPLE_BULB);
    expect(setBulbState).toHaveBeenCalledWith('kauf-bulb-7d49e0', { on: true, brightness: 55 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/bulbs.test.ts`
Expected: FAIL — old stub route doesn't implement `GET /bulb`/`POST /bulb`, and mocks `src/bulbs/service` which doesn't exist as an import in the current route file yet.

- [ ] **Step 3: Replace `src/routes/bulbs.ts`**

```typescript
// src/routes/bulbs.ts
import { Router, Request, Response } from 'express';
import { requireToken } from '../middleware/requireToken';
import { listWithLiveState, getWithLiveState, setBulbState } from '../bulbs/service';
import { SetStateOptions } from '../bulbs/deviceApi';

export const bulbsRouter = Router();
const requireBulbsToken = requireToken('BULBS_API_TOKENS');

function parseSetBody(body: Record<string, unknown>): { valid: boolean; options?: SetStateOptions } {
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

bulbsRouter.get('/bulbs', requireBulbsToken, async (_req: Request, res: Response) => {
  const bulbs = await listWithLiveState();
  res.status(200).json({ bulbs });
});

bulbsRouter.get('/bulb', requireBulbsToken, async (req: Request, res: Response) => {
  const id = req.query.id;
  if (typeof id !== 'string') {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const bulb = await getWithLiveState(id);
  if (!bulb) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  res.status(200).json(bulb);
});

bulbsRouter.post('/bulb', requireBulbsToken, async (req: Request, res: Response) => {
  const id = req.query.id;
  if (typeof id !== 'string') {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const parsed = parseSetBody(req.body ?? {});
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
});
```

- [ ] **Step 4: Re-add `express.json()` to `src/app.ts`**

Read the current `src/app.ts` first — it was modified in the skeleton phase's final-review fix wave to remove `express.json()` (nothing needed it then) and add a 404/error handler. Add `app.use(express.json());` back, immediately after `app.use(cookieParser());` and before the routers, preserving everything else (the 404 handler and error middleware stay last, after all routers).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/bulbs.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no other test file should be affected by re-adding `express.json()`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/bulbs.ts src/app.ts test/bulbs.test.ts
git commit -m "Implement GET /bulbs, GET /bulb, POST /bulb against live device state"
```

---

## Task 6: Web UI — bulb list and toggle button

**Files:**
- Modify: `src/views/page.ts`
- Modify: `src/routes/index.ts`
- Modify: `test/index.test.ts`

**Interfaces:**
- Consumes: `BulbWithState`, `listWithLiveState`, `getWithLiveState`, `setBulbState` from Task 4 (`src/bulbs/service.ts`).
- Produces: `renderPage(email: string, bulbs: BulbWithState[]): string` (signature change from the skeleton phase's `renderPage(email: string)`); `indexRouter` gains `POST /ui/bulb/:id/toggle` (session-cookie gated via `requireAuth`).

- [ ] **Step 1: Write the failing tests** (replaces the relevant parts of the existing file; the `GET /favicon.png` block is untouched)

```typescript
// test/index.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../src/bulbs/service', () => ({
  listWithLiveState: vi.fn(),
  getWithLiveState: vi.fn(),
  setBulbState: vi.fn(),
}));

import { createApp } from '../src/app';
import { signSession } from '../src/session';
import { listWithLiveState, getWithLiveState, setBulbState } from '../src/bulbs/service';

beforeEach(() => {
  vi.mocked(listWithLiveState).mockResolvedValue([]);
});

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

  it('lists discovered bulbs with their status', async () => {
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

    expect(response.text).toContain('Kauf Bulb 7d49e0');
    expect(response.text).toContain('/ui/bulb/kauf-bulb-7d49e0/toggle');
  });

  it('shows the empty-state message when no bulbs are discovered', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/').set('Cookie', cookie);

    expect(response.text).toContain('No bulbs discovered yet.');
  });
});

describe('GET /favicon.png', () => {
  it('returns the favicon image with no auth required', async () => {
    const app = createApp();
    const response = await request(app).get('/favicon.png');

    expect(response.status).toBe(200);
    expect(response.type).toBe('image/png');
    expect(response.body.length).toBeGreaterThan(0);
  });
});

describe('POST /ui/bulb/:id/toggle', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).post('/ui/bulb/kauf-bulb-7d49e0/toggle');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('flips the current state and redirects to / on success', async () => {
    vi.mocked(getWithLiveState).mockResolvedValue({
      id: 'kauf-bulb-7d49e0',
      name: 'x',
      mac: 'x',
      lastIp: '192.168.1.26',
      online: true,
      on: false,
      brightness: null,
      r: null,
      g: null,
      b: null,
    });
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).post('/ui/bulb/kauf-bulb-7d49e0/toggle').set('Cookie', cookie);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(setBulbState).toHaveBeenCalledWith('kauf-bulb-7d49e0', { on: true });
  });

  it('redirects to / without calling setBulbState when the bulb is unknown', async () => {
    vi.mocked(getWithLiveState).mockResolvedValue(null);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).post('/ui/bulb/nonexistent/toggle').set('Cookie', cookie);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(setBulbState).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/index.test.ts`
Expected: FAIL — `renderPage` still takes only `email`, no `/ui/bulb/:id/toggle` route exists yet.

- [ ] **Step 3: Replace `src/views/page.ts`**

```typescript
// src/views/page.ts
import { BulbWithState } from '../bulbs/service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBulbList(bulbs: BulbWithState[]): string {
  if (bulbs.length === 0) {
    return '<p id="bulbs-empty">No bulbs discovered yet.</p>';
  }

  const rows = bulbs
    .map((bulb) => {
      const statusClass = bulb.online ? (bulb.on ? 'on' : 'off') : 'offline';
      const statusText = bulb.online ? (bulb.on ? 'On' : 'Off') : 'Offline';
      return `
    <li class="bulb ${statusClass}">
      <span class="bulb-name">${escapeHtml(bulb.name)}</span>
      <span class="bulb-status">${statusText}</span>
      <form method="POST" action="/ui/bulb/${encodeURIComponent(bulb.id)}/toggle">
        <button type="submit" ${bulb.online ? '' : 'disabled'}>${bulb.on ? 'Turn off' : 'Turn on'}</button>
      </form>
    </li>`;
    })
    .join('');

  return `<ul id="bulbs-list">${rows}</ul>`;
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
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 3rem auto; padding: 0 1rem; }
    header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    a.logout { color: #666; text-decoration: none; font-size: 0.9rem; }
    a.logout:hover { text-decoration: underline; }
    #bulbs-empty { color: #888; font-style: italic; }
    #bulbs-list { list-style: none; padding: 0; }
    .bulb { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 0; border-bottom: 1px solid #eee; }
    .bulb-name { flex: 1; }
    .bulb-status { font-size: 0.85rem; padding: 0.2rem 0.6rem; border-radius: 1rem; }
    .bulb.on .bulb-status { background: #d4f7d4; color: #1a6b1a; }
    .bulb.off .bulb-status { background: #eee; color: #555; }
    .bulb.offline .bulb-status { background: #f7d4d4; color: #8b1a1a; }
    .bulb form { margin: 0; }
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
  ${renderBulbList(bulbs)}
</body>
</html>
`;
}
```

(This also escapes `email` — a minor hardening noted but not fixed during the skeleton phase's final review, since at the time nothing else in the page interpolated untrusted-ish data either. Fixing it now while touching this file is in scope; it is not a new task.)

- [ ] **Step 4: Replace `src/routes/index.ts`**

```typescript
// src/routes/index.ts
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPage } from '../views/page';
import { requireAuth } from '../middleware/requireAuth';
import { createAuthRateLimit } from '../middleware/authRateLimit';
import { verifySession } from '../session';
import { listWithLiveState, getWithLiveState, setBulbState } from '../bulbs/service';

export const indexRouter = Router();

const FAVICON_PATH = path.join(__dirname, '../../public/favicon.png');
const FAVICON = fs.readFileSync(FAVICON_PATH);

indexRouter.get('/favicon.png', (_req: Request, res: Response) => {
  res.status(200).type('image/png').send(FAVICON);
});

indexRouter.get('/', createAuthRateLimit(), requireAuth, async (req: Request, res: Response) => {
  const session = verifySession(req.cookies?.session);
  const bulbs = await listWithLiveState();
  res.status(200).type('html').send(renderPage(session?.email ?? '', bulbs));
});

indexRouter.post(
  '/ui/bulb/:id/toggle',
  createAuthRateLimit(),
  requireAuth,
  async (req: Request, res: Response) => {
    const current = await getWithLiveState(req.params.id);
    if (current) {
      await setBulbState(req.params.id, { on: !current.on });
    }
    res.redirect(302, '/');
  }
);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/index.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/views/page.ts src/routes/index.ts test/index.test.ts
git commit -m "Add bulb list and on/off toggle to the web UI"
```

---

## Task 7: Wire discovery into the server entrypoint

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `startDiscoveryLoop` from Task 3 (`src/bulbs/discovery.ts`).

No dedicated test — this is a two-line wiring change to an already-simple entrypoint (matches the skeleton phase's precedent for `src/middleware/authRateLimit.ts`/`requireAuth.ts`, which also had no dedicated test file). Verified via the build step and a local manual run below.

- [ ] **Step 1: Replace `src/server.ts`**

```typescript
// src/server.ts
import { createApp } from './app';
import { assertRequiredEnv } from './config';
import { startDiscoveryLoop } from './bulbs/discovery';

assertRequiredEnv();

const port = Number(process.env.PORT) || 8080;
const app = createApp();

app.listen(port, () => {
  console.log(`kauf-server listening on port ${port}`);
  startDiscoveryLoop();
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all prior tests plus this task's file unaffected (no test imports `server.ts` directly, matching the skeleton phase's pattern).

- [ ] **Step 3: Run the TypeScript compiler**

Run: `npm run build`
Expected: compiles cleanly, no errors.

- [ ] **Step 4: Manual local smoke test**

Run the compiled server locally with a scan CIDR scoped to just the real bulb's subnet-adjacent range for a fast local check (or the full default — either is fine locally, this is a manual one-off check, not part of CI):

```bash
GOOGLE_CLIENT_ID=smoke-test GOOGLE_CLIENT_SECRET=smoke-test \
GOOGLE_REDIRECT_URI=http://localhost:8080/auth/google/callback \
COOKIE_SECRET=smoke-test ALLOWED_EMAILS=you@example.com \
BULBS_API_TOKENS=smoke-test-token BULBS_DATA_PATH=/tmp/bulbs-smoketest.json \
BULB_SCAN_CIDR=192.168.1.0/24 \
node dist/server.js &
sleep 3
curl -s http://localhost:8080/health
sleep 15
curl -s http://localhost:8080/bulbs -H "Authorization: Bearer smoke-test-token"
kill %1
rm -f /tmp/bulbs-smoketest.json
```

Expected: `/health` returns `200 {"status":"ok"}` immediately; after the ~15s wait (long enough for a same-subnet scan to reach the real bulb at `192.168.1.26` from your own machine — this is run locally, not in the cluster, so it can actually reach the LAN), `/bulbs` returns the real discovered bulb with live state. This is a genuine end-to-end check against the real device, distinct from the mocked unit tests.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts
git commit -m "Start the discovery loop after the server starts listening"
```

---

## Task 8: Cluster manifests — PVC and volume mount

**Files** (in the separate `kube-setup` repo — not this one):
- Create: `manifests/bulbs/bulbs-pvc.yaml`
- Modify: `manifests/bulbs/bulbs-ksvc.yaml`

This task modifies live cluster state and a separate repo — per this session's established pattern (see the skeleton phase's Task 14/15), it is executed directly by the controller, not delegated to an implementer/reviewer subagent pair, and the cluster-apply step is confirmed with the user first.

- [ ] **Step 1: Write `kube-setup/manifests/bulbs/bulbs-pvc.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: bulbs-data-pvc
  namespace: bulbs
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 100Mi
  storageClassName: local-path
```

- [ ] **Step 2: Modify `kube-setup/manifests/bulbs/bulbs-ksvc.yaml`**

Read the current file first (its image tag will have moved since the skeleton phase — preserve whatever tag is currently there; the next deploy overwrites it anyway). Add:
- `backup.velero.io/backup-volumes: bulbs-data` to `spec.template.metadata.annotations` (alongside the existing `autoscaling.knative.dev/*` annotations)
- a `volumeMounts` entry on the `user-container` (alongside the existing `resources` key): `- mountPath: /data\n  name: bulbs-data`
- a `volumes` list on `spec.template.spec` (sibling to `containers`, alongside `enableServiceLinks`/`timeoutSeconds`): `- name: bulbs-data\n  persistentVolumeClaim:\n    claimName: bulbs-data-pvc`

Resulting file:

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
        backup.velero.io/backup-volumes: bulbs-data
    spec:
      containerConcurrency: 0
      containers:
      - envFrom:
        - secretRef:
            name: bulbs-oauth
        image: ghcr.io/klaushofrichter/kauf-server:<KEEP THE CURRENTLY-COMMITTED TAG>
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
          requests:
            cpu: 50m
            memory: 128Mi
          limits:
            cpu: 500m
            memory: 256Mi
        volumeMounts:
        - mountPath: /data
          name: bulbs-data
      enableServiceLinks: false
      timeoutSeconds: 300
      volumes:
      - name: bulbs-data
        persistentVolumeClaim:
          claimName: bulbs-data-pvc
  traffic:
  - latestRevision: true
    percent: 100
```

- [ ] **Step 3: Commit and push in `kube-setup`**

```bash
cd /Users/klaushofrichter/Development/kube-setup
git add manifests/bulbs/bulbs-pvc.yaml manifests/bulbs/bulbs-ksvc.yaml
git commit -m "Add bulbs-data PVC with Velero filesystem backup for the bulb directory"
git push
```

- [ ] **Step 4: Apply the PVC to the cluster** (confirm with the user before this step — it's a live-cluster change)

```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl apply -f /Users/klaushofrichter/Development/kube-setup/manifests/bulbs/bulbs-pvc.yaml
kubectl -n bulbs get pvc bulbs-data-pvc
```

Expected: PVC created; `STATUS` shows `Pending` until a pod actually mounts it (the `local-path` storage class is `WaitForFirstConsumer` — this is expected, not an error; it binds once the next deploy's pod starts).

Do **not** apply `bulbs-ksvc.yaml` directly in this task — Task 9's deploy (pushing to `main` then `production`) applies it as part of the normal CI/CD flow, with the image tag the deploy workflow fills in.

---

## Task 9: Deploy and live verification

Operational task — no code changes. Executed directly by the controller with user confirmation before pushing to `production` (matches the skeleton phase's established pattern for live deploys).

- [ ] **Step 1: Push to `main`, confirm the build succeeds**

```bash
cd /Users/klaushofrichter/Development/kauf-server
git push origin HEAD:refs/heads/main
gh run watch --repo klaushofrichter/kauf-server
```

Expected: `Build and publish image` workflow passes.

- [ ] **Step 2: Confirm with the user, then push to `production`**

```bash
git push origin HEAD:refs/heads/production
gh run watch --repo klaushofrichter/kauf-server
```

Expected: `Deploy production` workflow passes (including `Verify rollout`); the PVC binds now that a pod is mounting it.

- [ ] **Step 3: Verify the PVC bound and the pod is healthy**

```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl -n bulbs get pvc bulbs-data-pvc
kubectl -n bulbs get pods
```

Expected: PVC `STATUS` is now `Bound`; the `bulbs` pod is `2/2 Running`.

- [ ] **Step 4: Wait for a discovery scan, then verify the real bulb was found**

The in-process discovery loop runs once immediately on startup — no need to wait 20 minutes.

```bash
sleep 15
curl -s https://bulbs.skylar.technology/bulbs -H "Authorization: Bearer <real BULBS_API_TOKENS value>"
```

Expected: `200` with a `bulbs` array containing one entry for the real device — `id: "kauf-bulb-7d49e0"`, `mac: "C4:5B:BE:7D:49:E0"`, `online: true`, current live `on`/`brightness`/`r`/`g`/`b`.

- [ ] **Step 5: Verify `GET /bulb?id=` and `POST /bulb?id=` against the real device**

```bash
curl -s "https://bulbs.skylar.technology/bulb?id=kauf-bulb-7d49e0" -H "Authorization: Bearer <token>"

# Turn it off, verify, turn it back on to its prior brightness/color from the response above.
curl -s -X POST "https://bulbs.skylar.technology/bulb?id=kauf-bulb-7d49e0" \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"on": false}'
curl -s "https://bulbs.skylar.technology/bulb?id=kauf-bulb-7d49e0" -H "Authorization: Bearer <token>"
# Restore using the on/brightness/r/g/b captured before this test.
```

Expected: `on: false` confirmed after the set, then successfully restored.

- [ ] **Step 6: Verify the web UI**

Open `https://bulbs.skylar.technology/` in a browser (already signed in from the skeleton phase, or sign in again). Confirm the bulb list shows the real device with its name and current on/off status, and that clicking the toggle button actually turns the bulb on/off and the page reflects the new state after the redirect.

- [ ] **Step 7: Verify PVC data survives a pod restart**

```bash
export KUBECONFIG=~/.kube/k3s-config
kubectl -n bulbs delete pod -l serving.knative.dev/configuration=bulbs
sleep 10
curl -s https://bulbs.skylar.technology/bulbs -H "Authorization: Bearer <token>"
```

Expected: the bulb is still listed immediately (before a new scan would even run), with the same `id`/`mac`/`objectId` as before — confirming `/data/bulbs.json` persisted across the pod restart via the PVC, not just in-memory state.

---

## Self-Review Notes

- **Spec coverage:** device API research (Task 1), discovery scan + in-process scheduling (Tasks 3, 7), persistence with immutable/mutable field split (Task 2), live-state composition (Task 4), public Bearer-token API (Task 5), session-cookie-gated UI + toggle (Task 6), PVC + Velero backup annotation (Task 8), live end-to-end verification (Task 9) — every spec section has a task.
- **Placeholder scan:** no TBD/TODO. The only bracketed placeholders (`<KEEP THE CURRENTLY-COMMITTED TAG>`, `<real BULBS_API_TOKENS value>`, `<token>`) are in Task 8/9's operational instructions, which by nature reference values only known at execution time — not a plan gap, same pattern as the skeleton phase's Task 15.
- **Type consistency:** `SetStateOptions` (Task 1) used identically by `setBulbState` (Task 4) and `POST /bulb`'s body parser (Task 5). `BulbWithState` (Task 4) used identically by `GET /bulbs`/`GET /bulb` (Task 5) and `renderPage`/the toggle route (Task 6). `StoredBulb` (Task 2) used identically by `service.ts` (Task 4) and `discovery.ts`'s `upsertBulb` calls (Task 3). `renderPage`'s new two-argument signature is updated consistently everywhere it's called (only `src/routes/index.ts`).
