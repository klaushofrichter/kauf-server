import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signSession } from '../src/session';

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
