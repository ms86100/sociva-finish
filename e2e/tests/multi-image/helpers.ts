import { type Page, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const EVIDENCE_ROOT = path.resolve(__dirname, '../../../qa-evidence/multi-image');
export const FIXTURES = path.resolve(__dirname, '../../fixtures/multi-image');

export const IMAGES = {
  1: path.join(FIXTURES, 'image-1.png'),
  2: path.join(FIXTURES, 'image-2.png'),
  3: path.join(FIXTURES, 'image-3.png'),
  4: path.join(FIXTURES, 'image-4.png'),
  5: path.join(FIXTURES, 'image-5.png'),
  6: path.join(FIXTURES, 'image-6.png'),
};

export async function shot(page: Page, area: string, name: string) {
  const dir = path.join(EVIDENCE_ROOT, area);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

/** Bangalore coords near seeded Biryani / Salon / Yoga demo sellers. */
export const E2E_BUYER_LOCATION = {
  id: 'e2e-blr',
  label: 'E2E Bangalore',
  fullAddress: 'Near Biryani and Kebab, Bengaluru',
  lat: 13.0715890919546,
  lng: 77.7530337519604,
  source: 'address' as const,
};

/** Force marketplace discovery near demo sellers (geo gate). */
export async function seedBuyerLocation(page: Page) {
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
  }, E2E_BUYER_LOCATION);
}

export async function loginPhone(page: Page, phone = '0123456789', otp = '1234') {
  const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
  await seedBuyerLocation(page);
  await page.goto(`${base}/#/auth`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);

  // Already logged in — clear session and re-auth as the requested phone
  if (!page.url().includes('/auth')) {
    await page.evaluate((loc) => {
      try {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('sociva_browsing_location', JSON.stringify({ ...loc, _user_id: null }));
        localStorage.setItem(
          'sociva_last_browsing_coords',
          JSON.stringify({ id: loc.id, label: loc.label, lat: loc.lat, lng: loc.lng, source: loc.source }),
        );
      } catch {
        /* ignore */
      }
    }, E2E_BUYER_LOCATION);
    await page.goto(`${base}/#/auth`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(800);
  }

  if (!page.url().includes('/auth')) {
    // Still not on auth — force hash route
    await page.goto(`${base}/#/auth`);
    await page.waitForTimeout(800);
  }
  if (!page.url().includes('/auth')) return;

  const phoneInput = page.locator('input[type="tel"], input[placeholder*="phone" i], input[name="phone"]').first();
  await phoneInput.waitFor({ state: 'visible', timeout: 20_000 });
  await phoneInput.fill(phone);

  const age = page.locator('button[role="checkbox"]').first();
  if (await age.isVisible({ timeout: 2_000 }).catch(() => false)) {
    if ((await age.getAttribute('data-state')) !== 'checked') await age.click();
  }

  await page.locator('button:has-text("Send OTP"), button:has-text("Get OTP"), button:has-text("Continue")').first().click();
  await page.waitForTimeout(1200);

  const otpInputs = page.locator('input[maxlength="1"]');
  const count = await otpInputs.count();
  if (count >= 4) {
    for (let i = 0; i < otp.length && i < count; i++) {
      await otpInputs.nth(i).click();
      await otpInputs.nth(i).fill('');
      await otpInputs.nth(i).pressSequentially(otp[i], { delay: 40 });
    }
  } else {
    await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').first().fill(otp);
  }

  // Prefer auto-submit; click Verify only when enabled
  const verify = page.locator('button:has-text("Verify")').first();
  if (await verify.isVisible({ timeout: 2_000 }).catch(() => false)) {
    try {
      await verify.click({ timeout: 5_000 });
    } catch {
      // disabled / auto-navigating
    }
  }

  await page.waitForURL((u) => !u.hash.includes('/auth'), { timeout: 30_000 });

  // Re-assert Bangalore discovery location after session hydrate
  await page.evaluate((loc) => {
    try {
      localStorage.setItem('sociva_browsing_location', JSON.stringify({ ...loc, _user_id: null }));
      localStorage.setItem(
        'sociva_last_browsing_coords',
        JSON.stringify({ id: loc.id, label: loc.label, lat: loc.lat, lng: loc.lng, source: loc.source }),
      );
    } catch {
      /* ignore */
    }
  }, E2E_BUYER_LOCATION);
}

/** Dismiss success feedback so it cannot intercept the next Add click. */
async function dismissPhotoFeedback(page: Page) {
  const close = page.getByRole('button', { name: /^close$/i }).first();
  if (await close.isVisible({ timeout: 800 }).catch(() => false)) {
    await close.click({ force: true }).catch(() => {});
  }
  // Fallback: Escape / wait for overlay to clear
  const overlay = page.getByRole('status', { name: /photo saved/i });
  if (await overlay.isVisible({ timeout: 400 }).catch(() => false)) {
    await page.keyboard.press('Escape').catch(() => {});
    await overlay.waitFor({ state: 'hidden', timeout: 6_000 }).catch(() => {});
  }
}

/** Upload one product photo through CroppableImageUpload + Apply Crop. */
export async function uploadOfferingPhoto(page: Page, filePath: string) {
  const previous = await galleryPreviewCount(page);

  // Wait until prior upload fully committed (Add slot visible) before starting another
  if (previous > 0) {
    await dismissPhotoFeedback(page);
    const addBtn = page.locator('#edit-prod-image_url button[aria-label="Add photo"]').first();
    await addBtn.waitFor({ state: 'visible', timeout: 30_000 });
    await addBtn.click();
    await page.waitForTimeout(300);
  }

  const fileInput = page.locator('#edit-prod-image_url input[type="file"]').last();
  await fileInput.waitFor({ state: 'attached', timeout: 10_000 });
  await fileInput.setInputFiles(filePath);

  const apply = page.locator('button:has-text("Apply Crop")');
  await apply.waitFor({ state: 'visible', timeout: 15_000 });
  await apply.click();
  await apply.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});

  // Do not start the next upload until this one lands in the gallery
  await page.waitForFunction(
    (n) => {
      const root = document.querySelector('#edit-prod-image_url');
      if (!root) return false;
      const tested = root.querySelectorAll('[data-testid="offering-image"]').length;
      if (tested > n) return true;
      return root.querySelectorAll('img[alt^="Photo"]').length > n;
    },
    previous,
    { timeout: 45_000 },
  );

  await dismissPhotoFeedback(page);
}

export async function galleryPreviewCount(page: Page): Promise<number> {
  const tested = page.locator('#edit-prod-image_url [data-testid="offering-image"]');
  const testedCount = await tested.count();
  if (testedCount > 0) return testedCount;
  // Cover thumbs in OfferingImageGalleryUpload
  const thumbs = page.locator('#edit-prod-image_url img[alt^="Photo"]');
  const n = await thumbs.count();
  if (n > 0) return n;
  return page.locator('#edit-prod-image_url img').count();
}

export async function fillMinimalProduct(page: Page, name: string, _price = '199') {
  const nameInput = page.locator('#edit-prod-name input').first();
  await nameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await nameInput.fill(name);

  const desc = page.locator('textarea').first();
  if (await desc.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await desc.fill(`${name} — multi-image E2E description`);
  }

  // Food dietary required
  const veg = page.getByRole('button', { name: /^veg$/i }).first();
  if (await veg.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await veg.click();
  }
}

/** Advance gallery via pagination dot (more reliable than mouse drag in Chromium). */
export async function advanceCarousel(page: Page, toIndex = 1) {
  const dot = page.locator(`button[aria-label="Photo ${toIndex + 1}"]`).first();
  if (await dot.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await dot.click();
    await page.waitForTimeout(500);
    return;
  }
  await page.evaluate((idx) => {
    const scroller = document.querySelector('.snap-x') as HTMLElement | null;
    if (!scroller) return;
    scroller.scrollTo({ left: idx * scroller.clientWidth, behavior: 'instant' as ScrollBehavior });
  }, toIndex);
  await page.waitForTimeout(500);
}

export async function goToNewProduct(page: Page) {
  const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
  // Warm seller auth context first (avoids SellerRoute race → Home)
  await page.goto(`${base}/#/seller`);
  await page.waitForTimeout(1_500);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${base}/#/seller/products/new`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_200);
    const skip = page.locator('button:has-text("Skip"), button:has-text("Not now")').first();
    if (await skip.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await skip.click().catch(() => {});
    }
    const formReady = page.locator('#edit-prod-name input, #edit-prod-image_url').first();
    if (await formReady.isVisible({ timeout: 8_000 }).catch(() => false)) return;
    await page.waitForTimeout(1_500);
  }
  throw new Error(`Seller product form not reached. URL=${page.url()}`);
}

/** Fill price on pricing step (id=edit-prod-price). */
export async function fillPriceIfVisible(page: Page, price = '199') {
  const priceInput = page.locator('#edit-prod-price input, input[placeholder="0"]').first();
  if (await priceInput.isVisible({ timeout: 1_200 }).catch(() => false)) {
    await priceInput.fill('');
    await priceInput.fill(price);
  }
}

/** Prefer in-card mobile footer CTA (Pixel viewport hides desktop footer). */
async function wizardPrimaryCta(page: Page) {
  const mobile = page.locator('div.flex.sm\\:hidden').getByRole('button').filter({ hasText: /^(Next|Add|Save)$/ }).first();
  if (await mobile.isVisible({ timeout: 500 }).catch(() => false)) return mobile;
  return page.getByRole('button', { name: /^(Next|Add Product|Add|Save)$/ }).last();
}

/**
 * Walk seller product wizard to completion.
 * Mobile last CTA is "Add"; desktop is "Add Product"; edit mode is "Save".
 */
export async function saveProductForm(page: Page, price = '199') {
  for (let step = 0; step < 10; step++) {
    // Basics: dietary required for food
    const veg = page.getByRole('button', { name: /^veg$/i }).first();
    if (await veg.isVisible({ timeout: 400 }).catch(() => false)) {
      await veg.click().catch(() => {});
    }
    await fillPriceIfVisible(page, price);

    const cta = await wizardPrimaryCta(page);
    const label = ((await cta.textContent()) || '').trim();

    if (/^(Add Product|Add|Save)$/i.test(label)) {
      await cta.click();
      await Promise.race([
        page.waitForURL((u) => !u.hash.includes('/products/new'), { timeout: 30_000 }),
        page.waitForTimeout(5_000),
      ]).catch(() => {});
      await page.waitForTimeout(800);
      if (!page.url().includes('/products/new')) return;
      // Still on form — capture validation and retry once after filling price/veg
      await fillPriceIfVisible(page, price);
      const veg2 = page.getByRole('button', { name: /^veg$/i }).first();
      if (await veg2.isVisible({ timeout: 400 }).catch(() => false)) await veg2.click().catch(() => {});
      const retry = await wizardPrimaryCta(page);
      await retry.click();
      await page.waitForURL((u) => !u.hash.includes('/products/new'), { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (!page.url().includes('/products/new')) return;
      throw new Error(`Wizard submit stayed on form. URL=${page.url()} errors=${await page.locator('.text-destructive').allTextContents()}`);
    }

    if (/^Next$/i.test(label)) {
      await cta.click();
      await page.waitForTimeout(700);
      // If Next was blocked, step indicator / errors stay — try fill and continue
      const err = page.locator('p.text-destructive, .text-destructive').first();
      if (await err.isVisible({ timeout: 400 }).catch(() => false)) {
        await fillPriceIfVisible(page, price);
        const veg3 = page.getByRole('button', { name: /^veg$/i }).first();
        if (await veg3.isVisible({ timeout: 300 }).catch(() => false)) await veg3.click().catch(() => {});
        const again = await wizardPrimaryCta(page);
        await again.click();
        await page.waitForTimeout(700);
      }
      continue;
    }
    break;
  }
  throw new Error(`Could not finish wizard. URL=${page.url()}`);
}

/** Submit draft for approval from seller products list (if Submit shown). */
export async function submitDraftIfVisible(page: Page, productName: string) {
  const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
  await page.goto(`${base}/#/seller/products`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1_500);
  const row = page.getByText(productName, { exact: false }).first();
  if (!(await row.isVisible({ timeout: 8_000 }).catch(() => false))) return false;
  const submit = page.locator('button:has-text("Submit")').first();
  if (await submit.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await submit.click();
    await page.waitForTimeout(1_500);
    return true;
  }
  return false;
}

export async function expectToastContaining(page: Page, text: RegExp | string) {
  const toast = page.locator('[data-sonner-toast], [role="status"], .toast').filter({ hasText: text });
  await expect(toast.first()).toBeVisible({ timeout: 8_000 });
}
