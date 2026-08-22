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
  vi.mocked(listWithLiveState).mockReset().mockResolvedValue([]);
  vi.mocked(getWithLiveState).mockReset();
  vi.mocked(setBulbState).mockReset();
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
