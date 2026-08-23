import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';

const COOKIE_SECRET = 'e2e-test-cookie-secret';

function signSessionCookie(email: string): string {
  return jwt.sign({ email }, COOKIE_SECRET, { expiresIn: '7d' });
}

test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: 'session',
      value: signSessionCookie('e2e@example.com'),
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

test('opens the modal on card click and shows firmware/MAC details', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();
  await expect(page.locator('#modal-mac')).toHaveText('AA:BB:CC:DD:EE:FF');
  await expect(page.locator('#modal-firmware')).toHaveText('2.00(u)');
  await expect(page.locator('#modal-esphome')).toHaveText('2026.3.0');
});

test('adjusting brightness in the modal updates the card without a page reload', async ({ page }) => {
  await page.goto('/');
  await page.locator('.bulb-card[data-id="kauf-bulb-e2e"]').click();

  const modal = page.locator('#bulb-modal');
  await expect(modal).toBeVisible();

  const brightnessInput = page.locator('#modal-brightness');
  await brightnessInput.fill('80');
  await brightnessInput.dispatchEvent('change');

  await expect(page.locator('#modal-status')).toHaveText('On');

  await page.locator('.modal-close').click();
  await expect(modal).toBeHidden();
});
