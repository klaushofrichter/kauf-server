import { defineConfig } from '@playwright/test';
import path from 'path';

const TEST_PORT = 8099;
const DATA_PATH = path.join(__dirname, '.e2e-data', 'bulbs.json');

export default defineConfig({
  testDir: './test/e2e',
  globalSetup: require.resolve('./test/e2e/global-setup.ts'),
  timeout: 30000,
  webServer: {
    command: 'npx tsx src/server.ts',
    port: TEST_PORT,
    reuseExistingServer: false,
    env: {
      PORT: String(TEST_PORT),
      GOOGLE_CLIENT_ID: 'e2e-test-client',
      GOOGLE_CLIENT_SECRET: 'e2e-test-secret',
      GOOGLE_REDIRECT_URI: `http://localhost:${TEST_PORT}/auth/google/callback`,
      COOKIE_SECRET: 'e2e-test-cookie-secret',
      ALLOWED_EMAILS: 'e2e@example.com',
      BULBS_API_TOKENS: 'e2e-test-token',
      BULBS_DATA_PATH: DATA_PATH,
      // Yields zero scan addresses (a /32 has no usable hosts), so the
      // automatic startup discovery scan never touches the seeded fixture
      // data below or reaches out to any real network.
      BULB_SCAN_CIDR: '127.0.0.1/32',
      BULB_SCAN_INTERVAL_MS: String(24 * 60 * 60 * 1000),
    },
  },
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
  },
});
