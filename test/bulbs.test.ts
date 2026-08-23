// test/bulbs.test.ts
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

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

const SAMPLE_BULB_DETAIL = {
  ...SAMPLE_BULB,
  firmwareVersion: '2.00(u)',
  esphomeVersion: '2026.3.0',
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
    vi.mocked(getFullDetail).mockResolvedValue(null);
    const app = createApp();

    const response = await request(app)
      .get('/bulb?id=nonexistent')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not found' });
  });

  it('returns the bulb for a known id', async () => {
    vi.mocked(getFullDetail).mockResolvedValue(SAMPLE_BULB_DETAIL);
    const app = createApp();

    const response = await request(app)
      .get('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(SAMPLE_BULB_DETAIL);
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

  it('returns 429 when the device call is rate-limited', async () => {
    vi.mocked(setBulbState).mockResolvedValue({ success: false, rateLimited: true });
    const app = createApp();

    const response = await request(app)
      .post('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ on: true });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: 'rate limited' });
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

describe('PUT /bulb', () => {
  it('returns 401 with no Authorization header', async () => {
    const app = createApp();
    const response = await request(app).put('/bulb?id=kauf-bulb-7d49e0').send({ name: 'x' });
    expect(response.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'invalid request' });
  });

  it('returns 400 when name is not a string', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 42 });

    expect(response.status).toBe(400);
  });

  it('returns 400 when name is empty', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: '' });

    expect(response.status).toBe(400);
  });

  it('returns 404 for an unknown id', async () => {
    vi.mocked(renameBulbAndGetState).mockResolvedValue({ success: false, notFound: true });
    const app = createApp();

    const response = await request(app)
      .put('/bulb?id=nonexistent')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'New Name' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'not found' });
  });

  it('returns 200 with the renamed bulb on success', async () => {
    const renamed = { ...SAMPLE_BULB, name: 'Living Room Lamp' };
    vi.mocked(renameBulbAndGetState).mockResolvedValue({ success: true, bulb: renamed });
    const app = createApp();

    const response = await request(app)
      .put('/bulb?id=kauf-bulb-7d49e0')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({ name: 'Living Room Lamp' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(renamed);
    expect(renameBulbAndGetState).toHaveBeenCalledWith('kauf-bulb-7d49e0', 'Living Room Lamp');
  });
});

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

describe('async error boundary', () => {
  it('returns 500 instead of crashing when the service layer rejects', async () => {
    vi.mocked(listWithLiveState).mockRejectedValue(new Error('boom'));
    const app = createApp();

    const response = await request(app).get('/bulbs').set('Authorization', `Bearer ${TOKEN}`);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'internal server error' });
  });
});

// Placed last: this exhausts the per-route rate limiter counter for /bulbs,
// which would make earlier tests in this file that hit /bulbs flaky if run
// after it (each route's limiter instance is a module-level singleton
// shared across all tests in this file).
describe('GET /bulbs rate limiting', () => {
  it('rate-limits repeated requests', async () => {
    vi.mocked(listWithLiveState).mockResolvedValue([]);
    const app = createApp();
    let lastStatus = 0;

    for (let i = 0; i < 31; i += 1) {
      const response = await request(app).get('/bulbs').set('Authorization', `Bearer ${TOKEN}`);
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
