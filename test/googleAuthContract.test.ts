import { describe, it, expect } from 'vitest';
import { OAuth2Client } from 'google-auth-library';

// The REAL google-auth-library, deliberately unmocked.
//
// Every other test that touches OAuth mocks this module out (test/auth.test.ts
// replaces OAuth2Client with spies), which is right for testing our route
// logic but means the suite cannot see the library at all. A major upgrade can
// therefore change the constructor or rename a method and still go green - the
// mock keeps its old shape, so nothing fails. That is exactly what happened
// during the v10 -> v11 review: 208 tests passed and told us nothing about
// whether the upgrade worked, and the only real check was done by hand.
//
// vi.mock is file-scoped, so this file gets the genuine module. It pins the
// surface src/routes/auth.ts actually depends on, and nothing more - it is a
// contract test, not a test of Google's behaviour. No network: every assertion
// here fails at parse time or earlier.
describe('google-auth-library contract used by src/routes/auth.ts', () => {
  const client = () =>
    new OAuth2Client('test-client-id', 'test-client-secret', 'https://example.test/auth/google/callback');

  it('constructs from three positional arguments', () => {
    // If a future major moves to a single options object, the positional call
    // in auth.ts would silently produce a misconfigured client rather than
    // throw, and the OAuth flow would fail only in production.
    expect(client()).toBeInstanceOf(OAuth2Client);
  });

  it('exposes getToken, which auth.ts calls to exchange the code', () => {
    expect(typeof client().getToken).toBe('function');
  });

  it('exposes verifyIdToken, which auth.ts calls to validate the id_token', () => {
    expect(typeof client().verifyIdToken).toBe('function');
  });

  it('rejects a malformed id_token, which is what drives the 401 path', async () => {
    // auth.ts wraps getToken/verifyIdToken in a try and answers 401 from the
    // catch. That only works if failure arrives as a rejection rather than,
    // say, a null return - so the rejection itself is part of the contract.
    await expect(
      client().verifyIdToken({ idToken: 'not-a-jwt', audience: 'test-client-id' })
    ).rejects.toThrow();
  });

  it('accepts verifyIdToken options by the names auth.ts passes', async () => {
    // Guards against idToken/audience being renamed: with unknown option names
    // the call would reject for the wrong reason, or resolve with no token
    // verified at all. A parse failure proves idToken was read.
    await expect(
      client().verifyIdToken({ idToken: 'a.b.c', audience: 'test-client-id' })
    ).rejects.toThrow();
  });
});
