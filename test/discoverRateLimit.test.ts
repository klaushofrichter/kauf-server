import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/bulbs/service', () => ({
  listWithLiveState: vi.fn(),
  getWithLiveState: vi.fn(),
  getFullDetail: vi.fn(),
  setBulbState: vi.fn(),
  setAllBulbsState: vi.fn(),
  renameBulbAndGetState: vi.fn(),
}));

vi.mock('../src/bulbs/discovery', () => ({
  runDiscoveryScan: vi.fn(),
  getScanProgress: vi.fn(() => ({ running: false, scanned: 0, total: 0, cidr: '' })),
}));

import { createApp } from '../src/app';
import { signSession } from '../src/session';
import { listWithLiveState } from '../src/bulbs/service';
import { runDiscoveryScan } from '../src/bulbs/discovery';

// Deliberately its own file. The routers are built at module load, so their
// rate limiters are one shared instance per module registry - and vitest
// isolates modules per file. Sharing a file with the other /discover tests
// meant they spent this budget before these ran.
describe('POST /discover has its own, much stricter budget', () => {
  it('allows one sweep, then answers 429 without running a second', async () => {
    vi.mocked(runDiscoveryScan).mockResolvedValue(1);
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();

    const first = await request(app)
      .post('/discover')
      .set('Authorization', 'Bearer test-bulbs-token');
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/discover')
      .set('Authorization', 'Bearer test-bulbs-token');
    expect(second.status).toBe(429);
    expect(second.body).toEqual({ error: 'rate limited' });

    // The point of the limit: the expensive sweep must not have run again.
    expect(runDiscoveryScan).toHaveBeenCalledTimes(1);
  });

  it('does not let an invalid token spend a real token\'s discovery budget', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/discover')
      .set('Authorization', 'Bearer not-a-real-token');

    // 401 rather than 429: the token check runs first, so a rejected request
    // never reaches the discovery limiter and cannot consume its budget.
    expect(response.status).toBe(401);
  });
});

describe('the web UI Refresh shares that budget', () => {
  // Without this the strict API limit would be trivially sidestepped by
  // anyone holding a session - it is the same expensive sweep either way.
  it('redirects back with an explanation instead of a raw 429 body', async () => {
    vi.mocked(runDiscoveryScan).mockResolvedValue(1);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const first = await request(app).post('/ui/discover').set('Cookie', cookie);
    expect(first.status).toBe(302);
    expect(first.headers.location).toBe('/');

    const second = await request(app).post('/ui/discover').set('Cookie', cookie);
    expect(second.status).toBe(302);
    // A browser navigation, so answering with a JSON body would replace the
    // page with raw text. It goes back to the page with a flag instead, and
    // carries the seconds remaining so the page can say how long and stop
    // showing the warning once it expires.
    expect(second.headers.location).toMatch(/^\/\?scan=throttled&retry=\d+$/);
    const seconds = Number(new URL(second.headers.location, 'http://x').searchParams.get('retry'));
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });

  it('shows the throttle notice on the page when redirected back', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/?scan=throttled&retry=42').set('Cookie', cookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('You can refresh again in 42 seconds');
    expect(response.text).toContain('data-retry-after="42"');
    expect(response.text).not.toContain('aria-live="polite" hidden');
  });

  it('clamps a hand-edited retry value rather than rendering it', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    // It arrives in the URL, so it is user input; it only drives a countdown,
    // but it should not be able to park a warning on the page for an hour.
    const response = await request(app).get('/?scan=throttled&retry=99999').set('Cookie', cookie);

    expect(response.text).toContain('data-retry-after="300"');
  });

  it('ignores a non-numeric retry value and falls back to the vague wording', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/?scan=throttled&retry=abc').set('Cookie', cookie);

    expect(response.text).toContain('Please wait a moment');
    // The attribute form specifically - the string also appears in the
    // inline script that reads it.
    expect(response.text).not.toContain('data-retry-after="');
  });
});

describe('GET /ui/discover/progress', () => {
  it('reports progress without consuming the general request budget', async () => {
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    // Polling runs several times a second during a sweep. On the general
    // 30-per-15-minutes budget two refreshes would exhaust it and the UI
    // would start rate-limiting itself, so this route has its own ceiling.
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const res = await request(app).get('/ui/discover/progress').set('Cookie', cookie);
      last = res.status;
    }

    expect(last).toBe(200);
  });

  it('requires a session', async () => {
    const response = await request(createApp()).get('/ui/discover/progress');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });
});
