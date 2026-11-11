// Starts the e2e fixture on its own and keeps it running, for a server that
// Playwright does not start itself (CI runs the Docker image):
//
//   npx tsx test/e2e/mock-bulb.ts &
//
// Seeds .e2e-data/bulbs.json and serves the mock bulb on MOCK_BULB_PORT.
import { startFixture, MOCK_BULB_PORT, DATA_PATH } from './fixture';

startFixture().then(() => {
  console.log(`mock bulb on 127.0.0.1:${MOCK_BULB_PORT}, data in ${DATA_PATH}`);
});
