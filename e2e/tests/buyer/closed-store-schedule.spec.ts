import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3000';
const CLOSED_PRODUCT = '#/product/4b71a9b3-5c60-4393-b2a4-d41074b5f0ae';
const OPEN_PRODUCT = '#/product/8111d860-dbc8-42be-b8c7-5c4fe2bbf071';
const CLOSED_LOCATION = {
  id: 'e2e-arushi',
  label: 'Shriram Greenfield',
  fullAddress: 'Shriram Greenfield Amenities',
  lat: 13.071288775343321,
  lng: 77.75139142429262,
  source: 'address' as const,
};

async function seedLocation(page: Page) {
  await page.addInitScript((loc) => {
    try {
      localStorage.setItem('sociva_browsing_location', JSON.stringify({ ...loc, _user_id: null }));
      localStorage.setItem(
        'sociva_last_browsing_coords',
        JSON.stringify({ id: loc.id, label: loc.label, lat: loc.lat, lng: loc.lng, source: loc.source }),
      );
    } catch {
      /* ignore */
    }
  }, CLOSED_LOCATION);
}

async function dismissWalkthrough(page: Page) {
  const skip = page.getByRole('button', { name: /^Skip/i }).first();
  if (await skip.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await skip.click();
    await expect(skip).toBeHidden({ timeout: 8_000 }).catch(() => undefined);
  }
}

async function goHash(page: Page, hash: string) {
  const normalized = hash.startsWith('#') ? hash : `#${hash}`;
  await page.evaluate((next) => {
    window.location.hash = next;
  }, normalized);
  await page.waitForFunction((next) => window.location.hash.startsWith(next), normalized, { timeout: 10_000 });
  await page.waitForTimeout(600);
}

async function loginPhone(page: Page) {
  await seedLocation(page);
  await page.goto(`${BASE}/#/auth`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(700);
  if (!page.url().includes('/auth')) {
    await page.goto(`${BASE}/#/auth`);
    await page.waitForTimeout(700);
  }

  const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone" i], input[name="phone"]').first();
  await phoneInput.waitFor({ state: 'visible', timeout: 20_000 });
  await phoneInput.fill('0123456789');

  const age = page.locator('button[role="checkbox"]').first();
  if (await age.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if ((await age.getAttribute('data-state')) !== 'checked') await age.click();
  }

  await page.locator('button:has-text("Send OTP"), button:has-text("Get OTP"), button:has-text("Continue")').first().click();
  await page.waitForTimeout(1000);

  const otpInputs = page.locator('input[maxlength="1"]');
  const count = await otpInputs.count();
  if (count >= 4) {
    for (let i = 0; i < 4 && i < count; i++) {
      await otpInputs.nth(i).click();
      await otpInputs.nth(i).fill('');
      await otpInputs.nth(i).pressSequentially(String(1234)[i], { delay: 40 });
    }
  } else {
    await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').first().fill('1234');
  }

  const verify = page.locator('button:has-text("Verify")').first();
  if (await verify.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await verify.click({ timeout: 5_000 }).catch(() => undefined);
  }
  await page.waitForURL((u) => !u.hash.includes('/auth'), { timeout: 30_000 });
  await dismissWalkthrough(page);
}

async function emptyCart(page: Page) {
  await goHash(page, '#/cart');
  await page.waitForTimeout(800);
  const clearBtn = page.getByRole('button', { name: /^Clear$/ }).first();
  if (await clearBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await clearBtn.click();
    await page.getByRole('button', { name: /clear all/i }).click();
    await page.waitForTimeout(800);
  }
}

test.describe('Closed-store scheduled ordering', () => {
  test.describe.configure({ mode: 'serial' });

  test('closed shop listing lets the buyer schedule, and cart blocks immediate checkout @smoke', async ({ page }) => {
    await loginPhone(page);
    await emptyCart(page);
    await goHash(page, CLOSED_PRODUCT);

    await expect(page.getByText(/closed/i).first()).toBeVisible({ timeout: 20_000 });
    const scheduleCta = page.getByRole('button', { name: /schedule/i }).first();
    await expect(scheduleCta).toBeVisible({ timeout: 15_000 });
    await scheduleCta.click();

    await goHash(page, '#/cart');

    await expect(page.getByText(/schedule delivery/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/this store is closed/i)).toBeVisible();
    await expect(page.getByText(/ready in/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /place order/i })).toBeDisabled();
    await expect(page.getByText(/please select a delivery date/i)).toBeVisible();
  });

  test('open shop cart still allows immediate checkout without a required slot @smoke', async ({ page }) => {
    await loginPhone(page);
    await emptyCart(page);
    await goHash(page, OPEN_PRODUCT);

    const addBtn = page.getByRole('button', { name: /add|buy/i }).first();
    await expect(addBtn).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: /schedule/i })).toHaveCount(0);
    await addBtn.click();

    await goHash(page, '#/cart');

    await expect(page.getByText(/schedule for later/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/schedule delivery/i)).toHaveCount(0);
  });
});
