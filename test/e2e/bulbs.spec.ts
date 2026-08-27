import { test, expect } from '@playwright/test';
import { signSession } from '../../src/session';

// signSession() reads COOKIE_SECRET lazily at call time, so setting it here
// (this file runs in the Playwright test-runner process, separate from the
// `npx tsx src/server.ts` webServer subprocess) just needs to happen before
// signSession() is called below. Must match playwright.config.ts's
// webServer.env COOKIE_SECRET so cookies signed here verify against the
// server under test.
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'e2e-test-cookie-secret';

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'session',
      value: signSession('e2e@example.com'),
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: true,
    },
  ]);
});

test('renders a bulb card for the seeded bulb', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('.bulb-card[data-id="kauf-bulb-e2e"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.bulb-name')).toHaveText('E2E Test Bulb');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('the on/off toggle button works without JavaScript (plain form submit)', async ({ page }) => {
    await page.goto('/');
    const button = page.locator('.bulb-card[data-id="kauf-bulb-e2e"] .bulb-toggle-form button');
    const initialText = await button.textContent();

    await Promise.all([page.waitForURL('/'), button.click()]);

    const updatedText = await page
      .locator('.bulb-card[data-id="kauf-bulb-e2e"] .bulb-toggle-form button')
      .textContent();
    expect(updatedText).not.toBe(initialText);
  });
});

test('opens the modal on card click and shows firmware/MAC details', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  await expect(page.locator('#modal-firmware')).toHaveText('2.00(u)');
  await expect(page.locator('#modal-esphome')).toHaveText('2026.3.0');
});

test('adjusting brightness and clicking Set updates the card without a page reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();

  const brightnessInput = page.locator('#modal-brightness');
  await brightnessInput.fill('80');
  await page.locator('#modal-set').click();

  await expect(page.locator('#modal-error')).toBeEmpty();
  await expect(page.locator('#modal-status')).toHaveText('On');

  await page.locator('.modal-close').click();
  await expect(modal).toBeHidden();
});

test('editing the nickname and clicking Save name updates the card without a page reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();

  const nameInput = page.locator('#modal-name-input');
  await nameInput.fill('Renamed Bulb');
  await page.locator('#modal-name-save').click();

  await expect(page.locator('#modal-error')).toBeEmpty();
  await expect(page.locator('#modal-name')).toHaveText('Renamed Bulb');
  await expect(page.locator('.bulb-card[data-id="kauf-bulb-e2e"] .bulb-name')).toHaveText('Renamed Bulb');
});

test('moving the brightness slider alone does not send any request', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();

  let setRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/set') && request.method() === 'POST') setRequests += 1;
  });

  const brightnessInput = page.locator('#modal-brightness');
  await brightnessInput.fill('10');
  await brightnessInput.fill('20');
  await brightnessInput.fill('30');
  await brightnessInput.dispatchEvent('change');

  expect(setRequests).toBe(0);
});
