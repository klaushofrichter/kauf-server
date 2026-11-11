import { BrowserContext, TestInfo } from '@playwright/test';
import { createHash } from 'crypto';
import { signSession } from '../../src/session';

// The server's own signSession, so signed-in specs need no Google login and
// cannot drift from the real session format. COOKIE_SECRET must match the
// server under test: playwright.config.ts gives its webServer this default,
// and CI passes the same value to the Docker image.
export const E2E_COOKIE_SECRET = 'e2e-test-cookie-secret';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || E2E_COOKIE_SECRET;

/** Signs in a fresh, made-up user for this one test.
 *
 *  Fresh per test because the UI's rate limiter keys on the signed-in user
 *  (30 requests per 15 minutes, src/middleware/authRateLimit.ts). One shared
 *  test user would put four browsers' worth of page loads in one bucket and
 *  fail on the 31st, depending on which tests happened to run first. The
 *  limiter itself is unchanged and has its own unit tests. requireAuth checks
 *  only the signature, which is why an address outside ALLOWED_EMAILS works
 *  here: ALLOWED_EMAILS is enforced when Google hands a user back. */
export async function signIn(context: BrowserContext, baseURL: string, info: TestInfo): Promise<string> {
  // Short, like a real address: the header shows it, and a 70-character one
  // tests a layout nobody has.
  const id = createHash('sha256').update(`${info.project.name} ${info.testId}`).digest('hex').slice(0, 8);
  const email = `e2e-${id}@example.com`;
  await context.addCookies([
    {
      name: 'session',
      value: signSession(email),
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: true,
      // The server marks its own cookie Secure; this one is for http://localhost,
      // which WebKit would otherwise not send it to.
      secure: false,
      sameSite: 'Lax',
    },
  ]);
  return email;
}
