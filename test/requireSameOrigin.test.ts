import { describe, it, expect, vi, beforeEach } from 'vitest';
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
}));

import { createApp } from '../src/app';
import { signSession } from '../src/session';
import { getWithLiveState, setBulbState, setAllBulbsState } from '../src/bulbs/service';

const cookie = () => `session=${signSession('allowed@example.com')}`;

beforeEach(() => {
  vi.mocked(getWithLiveState).mockReset().mockResolvedValue(null);
  vi.mocked(setBulbState).mockReset();
  vi.mocked(setAllBulbsState).mockReset().mockResolvedValue([]);
});

describe('CSRF protection on the cookie-authenticated /ui routes', () => {
  it('rejects a state-changing POST from another origin', async () => {
    const response = await request(createApp())
      .post('/ui/bulbs/off')
      .set('Cookie', cookie())
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'cross-origin request rejected' });
    // The point of the check: the handler must never run.
    expect(setAllBulbsState).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin POST identified only by Referer', async () => {
    const response = await request(createApp())
      .post('/ui/bulbs/off')
      .set('Cookie', cookie())
      .set('Referer', 'https://evil.example.com/attack.html');

    expect(response.status).toBe(403);
    expect(setAllBulbsState).not.toHaveBeenCalled();
  });

  it('allows a same-origin POST', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/ui/bulbs/off')
      .set('Cookie', cookie())
      .set('Origin', 'http://127.0.0.1')
      .set('Host', '127.0.0.1');

    expect(response.status).toBe(302);
    expect(setAllBulbsState).toHaveBeenCalledWith(false);
  });

  it('allows a request with neither Origin nor Referer (non-browser client)', async () => {
    const response = await request(createApp()).post('/ui/bulbs/off').set('Cookie', cookie());

    expect(response.status).toBe(302);
    expect(setAllBulbsState).toHaveBeenCalledWith(false);
  });

  it('does not interfere with safe methods from another origin', async () => {
    const response = await request(createApp())
      .get('/health')
      .set('Origin', 'https://evil.example.com');

    expect(response.status).toBe(200);
  });

  it('still requires authentication - origin alone is not authorisation', async () => {
    const response = await request(createApp())
      .post('/ui/bulbs/off')
      .set('Origin', 'https://evil.example.com');

    // Cross-origin is rejected before auth even matters.
    expect(response.status).toBe(403);
    expect(setAllBulbsState).not.toHaveBeenCalled();
  });
});
