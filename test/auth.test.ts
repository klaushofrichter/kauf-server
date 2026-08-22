import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

const getTokenMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({
    getToken: getTokenMock,
    verifyIdToken: verifyIdTokenMock,
  })),
}));

import { createApp } from '../src/app';
import type { Express } from 'express';

async function getValidStateAndCookie(app: Express): Promise<{ state: string; cookie: string }> {
  const response = await request(app).get('/');
  const setCookieHeader = response.headers['set-cookie']?.find((cookie: string) =>
    cookie.startsWith('oauth_state=')
  ) as string;
  const cookie = setCookieHeader.split(';')[0];
  const state = cookie.split('=')[1];
  return { state, cookie };
}

describe('GET /auth/google/callback', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('rejects a request with no code', async () => {
    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get(`/auth/google/callback?state=${state}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 when the token exchange fails', async () => {
    getTokenMock.mockRejectedValue(new Error('exchange failed'));

    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get(`/auth/google/callback?code=abc123&state=${state}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('sets a session cookie and redirects to / for an allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: true }),
    });

    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get(`/auth/google/callback?code=abc123&state=${state}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']?.some((c: string) => c.startsWith('session='))).toBe(true);
  });

  it('returns 403 with no session cookie for a non-allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'stranger@example.com', email_verified: true }),
    });

    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get(`/auth/google/callback?code=abc123&state=${state}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'forbidden' });
    expect(response.headers['set-cookie']?.some((c: string) => c.startsWith('session='))).toBeFalsy();
  });

  it('returns 401 with no session cookie when the email is unverified, even if allowlisted', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: false }),
    });

    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get(`/auth/google/callback?code=abc123&state=${state}`)
      .set('Cookie', cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(response.headers['set-cookie']?.some((c: string) => c.startsWith('session='))).toBeFalsy();
  });
});

describe('GET /auth/google/callback OAuth state validation', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('rejects with 401 when the state param does not match the oauth_state cookie', async () => {
    const app = createApp();
    const { cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get('/auth/google/callback?code=abc123&state=wrong-state')
      .set('Cookie', cookie);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the oauth_state cookie is missing entirely', async () => {
    const app = createApp();
    const { state } = await getValidStateAndCookie(app);
    const response = await request(app).get(`/auth/google/callback?code=abc123&state=${state}`);

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(getTokenMock).not.toHaveBeenCalled();
  });

  it('clears the oauth_state cookie on the callback response', async () => {
    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const response = await request(app)
      .get(`/auth/google/callback?code=abc123&state=${state}`)
      .set('Cookie', cookie);

    const clearedCookie = response.headers['set-cookie']?.find((c: string) =>
      c.startsWith('oauth_state=')
    );
    expect(clearedCookie).toBeDefined();
    expect(clearedCookie).toContain('oauth_state=;');
  });
});

describe('GET /auth/google/callback -> GET / integration', () => {
  beforeEach(() => {
    getTokenMock.mockReset();
    verifyIdTokenMock.mockReset();
  });

  it('accepts the exact cookie the callback route emits when replayed against GET /', async () => {
    getTokenMock.mockResolvedValue({ tokens: { id_token: 'fake-id-token' } });
    verifyIdTokenMock.mockResolvedValue({
      getPayload: () => ({ email: 'allowed@example.com', email_verified: true }),
    });

    const app = createApp();
    const { state, cookie } = await getValidStateAndCookie(app);
    const callbackResponse = await request(app)
      .get(`/auth/google/callback?code=abc123&state=${state}`)
      .set('Cookie', cookie);

    expect(callbackResponse.status).toBe(302);
    const setCookieHeader = callbackResponse.headers['set-cookie']?.find((c: string) =>
      c.startsWith('session=')
    );
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('Secure');
    expect(setCookieHeader).toContain('SameSite=Lax');

    const response = await request(app).get('/').set('Cookie', setCookieHeader as string);

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
  });
});

describe('GET /auth/logout', () => {
  it('clears the session cookie and redirects to /', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout').set('Cookie', 'session=some-token');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    const setCookieHeader = response.headers['set-cookie']?.[0];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('session=;');
  });

  it('redirects to / and clears the cookie even with no existing session', async () => {
    const app = createApp();
    const response = await request(app).get('/auth/logout');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('logging out then visiting / redirects to Google sign-in again', async () => {
    const app = createApp();
    const logoutResponse = await request(app).get('/auth/logout').set('Cookie', 'session=some-token');
    const setCookieHeader = logoutResponse.headers['set-cookie']?.[0] as string;

    const response = await request(app).get('/').set('Cookie', setCookieHeader);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('accounts.google.com');
  });
});

describe('GET /auth/google/callback rate limiting', () => {
  it('rate-limits repeated requests', async () => {
    const app = createApp();
    let lastStatus = 0;
    for (let i = 0; i < 31; i += 1) {
      const response = await request(app).get('/auth/google/callback');
      lastStatus = response.status;
    }

    expect(lastStatus).toBe(429);
  });
});
