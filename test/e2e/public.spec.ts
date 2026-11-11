/**
 * What a signed-out visitor can reach. There is not much: `/` hands straight
 * over to Google, and the rest is the JSON API for devices on the LAN. So the
 * public surface is the sign-in hand-over, the 404 page, the favicon and
 * /health, and all of it is checked here in four browsers.
 *
 * Every test here carries @live: live-check.yml runs them against production
 * after each release and daily. They only GET, never sign in, never POST,
 * never send a token and never touch a bulb route (/bulb, /bulbs, /discover,
 * /ui/...), so they cannot change a real bulb or spend the household's
 * rate-limit budget. The one request that counts against a limiter (the
 * signed-out `/`) is made once per run, from desktop Chromium only, and from
 * GitHub's runners it counts against GitHub's address, not the house's.
 */
import { test, expect } from '@playwright/test';
import { audit, expectAllPicturesLoaded, reportCspViolations, watchProblems } from './helpers';

test('@live /health answers with the expected version', async ({ request }) => {
  const res = await request.get('/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
  if (process.env.EXPECT_VERSION) expect(body.version).toBe(process.env.EXPECT_VERSION);
});

test('@live a signed-out visit is handed to Google sign-in and nowhere else', async ({ request, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'one request per run: it counts against the sign-in limiter');
  const res = await request.get('/', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const to = new URL(res.headers()['location']);
  expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(to.searchParams.get('redirect_uri')).toBe(new URL('/auth/google/callback', baseURL).href);
  expect(to.searchParams.get('scope')).toBe('openid email');
  expect(to.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
});

test('@live an unknown address shows a 404 page that leads back to the app', async ({ page }) => {
  const problems = watchProblems(page);
  await reportCspViolations(page);
  const res = await page.goto('/does-not-exist');
  expect(res?.status()).toBe(404);
  await expect(page).toHaveTitle('Page not found - Kauf Bulbs');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  // The only link. It goes to `/`, which hands over to Google: checked above,
  // and not followed here, as the baseline stops at a sign-in link.
  const links = page.getByRole('link');
  await expect(links).toHaveCount(1);
  await expect(links).toHaveAttribute('href', '/');
  await expectAllPicturesLoaded(page);
  expect(problems).toEqual([]);
});

test('@live API callers still get a JSON 404', async ({ request }) => {
  const res = await request.get('/does-not-exist', { headers: { Accept: '*/*' } });
  expect(res.status()).toBe(404);
  expect(await res.json()).toEqual({ error: 'not found' });
});

test('@live the favicon is served, small, and needs no sign-in', async ({ request }) => {
  const res = await request.get('/favicon.png');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  // It is also the icon beside the page title. It was a 726x762, 76 KB
  // original until 2026-11-10; the page draws it about 51 px tall. Now 192 px
  // wide, 4 KB.
  expect((await res.body()).length).toBeLessThan(10_000);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`@live the 404 page meets WCAG 2.2 AA (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/does-not-exist');
    await audit(page);
  });
}

test('@live nothing jumps while the 404 page loads (layout shift)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/does-not-exist');
  await expectAllPicturesLoaded(page);
  // Only Chromium reports layout shifts; elsewhere this reads 0.
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.02);
});
