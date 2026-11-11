import { startFixture } from './fixture';

// With no BASE_URL, Playwright starts the server itself (playwright.config.ts)
// and the mock bulb runs here, in the Playwright CLI's process, for the whole
// run; its socket closes when `playwright test` exits.
//
// With BASE_URL set, the server was started elsewhere: in CI the Docker image,
// next to `test/e2e/mock-bulb.ts`; or it is the live site, where there is no
// fixture at all and only @live tests run.
export default async function globalSetup(): Promise<void> {
  if (process.env.BASE_URL) return;
  await startFixture();
}
