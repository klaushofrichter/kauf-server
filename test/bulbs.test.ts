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
