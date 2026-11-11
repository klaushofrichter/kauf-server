import { defineConfig, devices } from '@playwright/test';
import { DATA_PATH } from './test/e2e/fixture';
import { E2E_COOKIE_SECRET } from './test/e2e/session';

/**
 * Where the suite points:
 *  - BASE_URL unset: Playwright starts the server from source on port 8099,
 *    with the mock bulb from test/e2e/fixture.ts (a local run).
 *  - BASE_URL=http://localhost:8080: a server already running, which in CI is
 *    the Docker image this commit builds (production-checks.yml), next to
 *    test/e2e/mock-bulb.ts.
 *  - BASE_URL=https://bulbs.skylar.technology with --grep @live: production,
 *    after a release (live-check.yml). Only tests tagged @live run there, and
 *    they never sign in, never POST and never call a bulb route or send a
 *    token: they cannot change a real bulb or spend the household's
 *    rate-limit budget.
 *
 * Follows kube-setup's "public web pages" baseline
 * (docs/cluster-deployment-requirements.md, §4).
 */
const TEST_PORT = 8099;
const BASE_URL = process.env.BASE_URL || `http://localhost:${TEST_PORT}`;
const LIVE = BASE_URL.startsWith('https://');

// Stateful specs change the mock bulb and its data file. Four browsers running
// them at once would edit each other's bulb, so they run in desktop Chromium
// only. Everything else is read-only and runs in all four.
const STATEFUL = /bulbs\.spec\.ts/;

// For machines with a Chromium outside Playwright's cache. Unset in CI.
const chromiumLaunch = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: require.resolve('./test/e2e/global-setup.ts'),
  // One retry absorbs a runner hiccup, but a test that needed it fails the run
  // anyway: a "passed on retry" has been a real bug elsewhere (kube-setup
  // vault, Gotchas, "Lazy pictures take no space in Firefox and Safari").
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  forbidOnly: !!process.env.CI,
  timeout: LIVE ? 60_000 : 30_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npx tsx src/server.ts',
        port: TEST_PORT,
        // Never someone else's server: a stale one left on this port would
        // be tested instead of this checkout.
        reuseExistingServer: false,
        env: {
          PORT: String(TEST_PORT),
          GOOGLE_CLIENT_ID: 'e2e-test-client',
          GOOGLE_CLIENT_SECRET: 'e2e-test-secret',
          GOOGLE_REDIRECT_URI: `http://localhost:${TEST_PORT}/auth/google/callback`,
          COOKIE_SECRET: E2E_COOKIE_SECRET,
          ALLOWED_EMAILS: 'e2e@example.com',
          BULBS_API_TOKENS: 'e2e-test-token',
          BULBS_DATA_PATH: DATA_PATH,
          // Yields zero scan addresses (a /32 has no usable hosts), so the
          // automatic startup discovery scan never touches the seeded fixture
          // data or reaches out to any real network.
          BULB_SCAN_CIDR: '127.0.0.1/32',
          BULB_SCAN_INTERVAL_MS: String(24 * 60 * 60 * 1000),
        },
      },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Desktop Chrome, an Android phone, an iPhone (WebKit is Safari's engine)
  // and desktop Firefox.
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], launchOptions: chromiumLaunch } },
    { name: 'phone-chromium', testIgnore: STATEFUL, use: { ...devices['Pixel 7'], launchOptions: chromiumLaunch } },
    { name: 'phone-webkit', testIgnore: STATEFUL, use: { ...devices['iPhone 13'] } },
    { name: 'desktop-firefox', testIgnore: STATEFUL, use: { ...devices['Desktop Firefox'] } },
  ],
});
