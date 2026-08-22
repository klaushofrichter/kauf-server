import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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

describe('GET /', () => {
  it('redirects to Google sign-in when there is no session cookie', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });

  it('sets an oauth_state cookie whose value matches the state param in the redirect URL', async () => {
    const app = createApp();
    const response = await request(app).get('/');

    expect(response.status).toBe(302);
    const setCookieHeader = response.headers['set-cookie']?.find((cookie: string) =>
      cookie.startsWith('oauth_state=')
    );
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('HttpOnly');

    const stateInCookie = setCookieHeader?.split(';')[0].split('=')[1];
    const redirectUrl = new URL(response.headers.location);
    const stateInUrl = redirectUrl.searchParams.get('state');

    expect(stateInUrl).toBeTruthy();
    expect(stateInUrl).toBe(stateInCookie);
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

  it('shows the empty-state message when no bulbs are discovered', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();
    const cookie = `session=${signSession('allowed@example.com')}`;

    const response = await request(app).get('/').set('Cookie', cookie);

    expect(response.text).toContain('No bulbs discovered yet.');
  });
});

describe('GET /nonexistent', () => {
  it('returns a JSON 404 for an unknown path', async () => {
    const app = createApp();
    const response = await request(app).get('/nonexistent');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not found' });
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
