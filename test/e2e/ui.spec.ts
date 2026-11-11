/**
 * The bulb panel, signed in, walked in four browsers: desktop Chrome, an
 * Android phone, an iPhone (WebKit) and desktop Firefox. It is the page this
 * service exists for and it is used from phones, so although it is not public
 * it gets the public pages' treatment, read-only: nothing here posts or
 * changes the bulb (bulbs.spec.ts does that, in one browser).
 *
 * Not @live: the live check never signs in.
 */
import { test, expect } from '@playwright/test';
import { audit, expectAllPicturesLoaded, reportCspViolations, watchProblems } from './helpers';
import { signIn } from './session';
import { BULB_ID } from './fixture';
import { renderPage } from '../../src/views/page';

const card = `.bulb-card[data-id="${BULB_ID}"]`;

test.beforeEach(async ({ context, baseURL }, testInfo) => {
  await signIn(context, baseURL!, testInfo);
});

test('the panel loads complete, with no errors along the way', async ({ page }) => {
  const problems = watchProblems(page);
  await reportCspViolations(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Kauf Bulbs');
  await expect(page.locator(card)).toBeVisible();
  await expectAllPicturesLoaded(page);
  if (process.env.EXPECT_VERSION) await expect(page.locator('#app-version')).toHaveText(process.env.EXPECT_VERSION);
  // Opening the details is a read too; it must not error either.
  await page.locator(`${card} .bulb-name`).click();
  await expect(page.locator('#bulb-modal')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#bulb-modal')).toBeHidden();
  expect(problems).toEqual([]);
});

test('every link on the panel lands', async ({ page }) => {
  await page.goto('/');
  const hrefs = await page.locator('a').evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute('href')));
  expect(hrefs.sort()).toEqual(['/auth/logout', 'https://github.com/klaushofrichter/kauf-server']);

  // The version opens the source in a new tab, without handing it this window.
  const source = page.locator('#app-version');
  await expect(source).toHaveAttribute('target', '_blank');
  await expect(source).toHaveAttribute('rel', /noopener/);

  // Sign out ends the session and returns to `/`, which then hands over to
  // Google (public.spec.ts); not followed further.
  const out = await page.request.get('/auth/logout', { maxRedirects: 0 });
  expect(out.status()).toBe(302);
  expect(out.headers()['location']).toBe('/');
  expect(out.headers()['set-cookie']).toMatch(/^session=;/);
});

test('a bulb opens and closes from the keyboard', async ({ page, browserName }) => {
  await page.goto('/');
  // Each bulb's name is a real button, reached with Tab. (WebKit only tabs to
  // buttons with the macOS "all controls" setting; focus() is what a Safari
  // keyboard user's setting would do.)
  const name = page.locator(`${card} .bulb-name`);
  if (browserName === 'webkit') await name.focus();
  else {
    for (let i = 0; i < 20 && !(await name.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  }
  await expect(name).toBeFocused();
  await page.keyboard.press('Enter');
  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  // A synthetic Escape does not reach the page in the emulated iPhone, so the
  // close button is what is tested there (kube-setup, §4 test-suite traps).
  if (browserName === 'webkit') await page.getByRole('button', { name: 'Close' }).click();
  else await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('a bulb opens and closes by touch', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone projects only');
  await page.goto('/');
  // Anywhere on the card, as a thumb would, except its on/off button.
  await page.locator(`${card} .bulb-icon`).tap();
  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).tap();
  await expect(modal).toBeHidden();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the panel meets WCAG 2.2 AA (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator(card)).toBeVisible();
    await audit(page);
  });
}

test('the bulb details dialog meets WCAG 2.2 AA', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.locator(`${card} .bulb-name`).click();
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  await audit(page);
});

test('the scan-throttled notice meets WCAG 2.2 AA', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?scan=throttled&retry=60');
  await expect(page.locator('#busy-panel')).toBeVisible();
  await audit(page);
});

test('the panel with no bulbs yet meets WCAG 2.2 AA', async ({ page }) => {
  // A state the fixture never reaches, rendered by the server's own template.
  // /health first, so /favicon.png resolves against the server under test.
  await page.goto('/health');
  await page.setContent(renderPage('e2e@example.com', []));
  await expect(page.locator('#bulbs-empty')).toBeVisible();
  await audit(page);
});

test('nothing jumps while the panel loads (layout shift)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto('/');
  await expectAllPicturesLoaded(page);
  // Only Chromium reports layout shifts; elsewhere this reads 0, which is why
  // the title icon's box is checked directly below.
  expect(await page.evaluate(() => (window as unknown as { __cls: number }).__cls)).toBeLessThan(0.02);
});

test('the title icon holds its place before it arrives', async ({ page }) => {
  await page.route('**/favicon.png', () => {});
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const box = await page.locator('.title-icon').boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(30);
  expect(box?.width ?? 0).toBeGreaterThan(30);
});

test('a phone fetches little, and no picture larger than it needs', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone projects only');
  await page.goto('/', { waitUntil: 'load' });
  await expectAllPicturesLoaded(page);
  const entries = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .concat(performance.getEntriesByType('navigation'))
      .map((e) => ({ url: e.name.replace(location.origin, ''), bytes: (e as PerformanceResourceTiming).encodedBodySize })),
  );
  // The page, with its inline style and script: about 21 KB, uncompressed
  // (nothing between the browser and the app compresses it).
  const text = entries.filter((e) => !/\.png$/.test(e.url));
  expect(text.reduce((n, e) => n + e.bytes, 0)).toBeLessThan(30_000);

  // The title icon at the size the screen needs, never more than about twice
  // that: drawn width times the pixel ratio, against the file's own width.
  const icon = await page.locator('.title-icon').evaluate((img) => ({
    file: (img as HTMLImageElement).naturalWidth,
    need: img.getBoundingClientRect().width * devicePixelRatio,
  }));
  expect(icon.file, `icon file for ${Math.round(icon.need)}px`).toBeLessThanOrEqual(Math.max(icon.need * 2, 192));
  const pictures = entries.filter((e) => /\.png$/.test(e.url));
  // The icon, 4 KB since 2026-11-10 (it was a 76 KB, 726 px original).
  expect(pictures.reduce((n, e) => n + e.bytes, 0)).toBeLessThan(10_000);
});

test('the panel and the bulb details fit the screen, with no sideways scrolling', async ({ page }) => {
  // On a Pixel the details dialog measured 443px wide in a 412px screen, so it
  // lost both edges and the close button sat under the dialog's own frame
  // (2026-11-10). Checked in every browser and on both phones.
  await page.goto('/');
  const fits = () =>
    page.evaluate(() => {
      const d = document.getElementById('bulb-modal')!.getBoundingClientRect();
      return {
        pageWider: document.documentElement.scrollWidth > window.innerWidth,
        dialogOff: d.width > 0 && (d.left < 0 || d.right > window.innerWidth),
      };
    });
  expect(await fits()).toEqual({ pageWider: false, dialogOff: false });
  await page.locator(`${card} .bulb-name`).click();
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  expect(await fits()).toEqual({ pageWider: false, dialogOff: false });
  // And the name field ends before Save name starts: on a phone it used to
  // run under the button (axe reported the overlap, 2026-11-10).
  const field = (await page.locator('#modal-name-input').boundingBox())!;
  const save = (await page.locator('#modal-name-save').boundingBox())!;
  expect(field.x + field.width).toBeLessThanOrEqual(save.x);
});

test('a click outside the bulb details closes them', async ({ page }) => {
  await page.goto('/');
  await page.locator(`${card} .bulb-name`).click();
  const modal = page.locator('#bulb-modal');
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  // A corner of the screen, which the dialog never covers.
  await page.mouse.click(2, 2);
  await expect(modal).toBeHidden();
});
