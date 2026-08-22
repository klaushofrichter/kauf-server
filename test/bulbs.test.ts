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
