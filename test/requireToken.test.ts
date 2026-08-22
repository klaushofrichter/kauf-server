import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireToken } from '../src/middleware/requireToken';

function buildApp(envVarName: string) {
  const app = express();
  app.get('/protected', requireToken(envVarName), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('requireToken', () => {
  it('rejects a request with no Authorization header', async () => {
    process.env.TEST_TOKENS = 'good-token';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a malformed Authorization header', async () => {
    process.env.TEST_TOKENS = 'good-token';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'good-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a well-formed but wrong token', async () => {
    process.env.TEST_TOKENS = 'good-token';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'Bearer wrong-token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('accepts a token that matches one entry in a comma-separated list', async () => {
    process.env.TEST_TOKENS = 'token-one, token-two ,token-three';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'Bearer token-two');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('rejects when the configured env var is empty', async () => {
    process.env.TEST_TOKENS = '';
    const app = buildApp('TEST_TOKENS');

    const response = await request(app).get('/protected').set('Authorization', 'Bearer anything');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });
});
