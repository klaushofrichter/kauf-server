import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  const original = process.env.APP_VERSION;
  afterEach(() => {
    if (original === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = original;
  });

  it('returns 200 with a status ok body and the stamped version', async () => {
    process.env.APP_VERSION = '2026-08-24.1';
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', version: '2026-08-24.1' });
  });

  it('falls back to dev when no version was stamped in', async () => {
    delete process.env.APP_VERSION;
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.body).toEqual({ status: 'ok', version: 'dev' });
  });
});
