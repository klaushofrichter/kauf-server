import { describe, it, expect, afterEach } from 'vitest';
import { assertRequiredEnv } from '../src/config';

const REQUIRED = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'COOKIE_SECRET',
  'ALLOWED_EMAILS',
  'BULBS_API_TOKENS',
];
const original: Record<string, string | undefined> = {};
REQUIRED.forEach((key) => {
  original[key] = process.env[key];
});

describe('assertRequiredEnv', () => {
  afterEach(() => {
    REQUIRED.forEach((key) => {
      if (original[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original[key];
      }
    });
  });

  it('does not throw when all required vars are set', () => {
    REQUIRED.forEach((key) => {
      process.env[key] = 'some-value';
    });

    expect(() => assertRequiredEnv()).not.toThrow();
  });

  it('throws listing every missing var', () => {
    REQUIRED.forEach((key) => {
      delete process.env[key];
    });

    expect(() => assertRequiredEnv()).toThrow(
      /GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*GOOGLE_REDIRECT_URI.*COOKIE_SECRET.*ALLOWED_EMAILS.*BULBS_API_TOKENS/s
    );
  });
});
