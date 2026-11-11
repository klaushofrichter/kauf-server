// Prints a session cookie value for a made-up test user, signed with the
// COOKIE_SECRET in the environment (CI's test value, never a real one), so
// Lighthouse can measure the signed-in page: production-checks.yml.
//
//   COOKIE_SECRET=... npx tsx scripts/e2e-session.ts lighthouse@example.com
import { signSession } from '../src/session';

process.stdout.write(signSession(process.argv[2] || 'lighthouse@example.com'));
