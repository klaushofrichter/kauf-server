import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signSession, verifySession } from '../src/session';

describe('signSession / verifySession', () => {
  it('round-trips a valid session', () => {
    const token = signSession('allowed@example.com');
    const result = verifySession(token);

    expect(result).toEqual({ email: 'allowed@example.com' });
  });

  it('returns null for a garbage token', () => {
    expect(verifySession('not-a-real-token')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = jwt.sign({ email: 'allowed@example.com' }, 'wrong-secret');
    expect(verifySession(token)).toBeNull();
  });

  it('returns null for an expired token', () => {
    const expired = jwt.sign(
      { email: 'allowed@example.com', exp: Math.floor(Date.now() / 1000) - 10 },
      process.env.COOKIE_SECRET as string
    );
    expect(verifySession(expired)).toBeNull();
  });

  it('returns null for a validly-signed token missing an email claim', () => {
    const noEmail = jwt.sign({ foo: 'bar' }, process.env.COOKIE_SECRET as string);
    expect(verifySession(noEmail)).toBeNull();
  });
});
