import { type Page, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
export const EVIDENCE_ROOT = path.resolve(__dirname, '../../../test-results/seller-onboarding-ux');

export const E2E_BUYER_LOCATION = {
  id: 'e2e-blr',
  label: 'E2E Bangalore',
  fullAddress: 'Near Cubbon Park, Bengaluru',
  lat: 12.9767,
  lng: 77.5713,
  source: 'address' as const,
};

export async function shot(page: Page, area: string, name: string) {
  const dir = path.join(EVIDENCE_ROOT, area);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export async function seedLocation(page: Page) {
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

/** Phone OTP bypass (Apple Review). */
export async function loginPhone(page: Page, phone = '0123456789', otp = '1234') {
  await seedLocation(page);
  await page.goto(`${BASE}/#/auth`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(700);

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
    await page.goto(`${BASE}/#/auth`);
    await page.waitForTimeout(700);
  }

  if (!page.url().includes('/auth')) {
    await page.goto(`${BASE}/#/auth`);
    await page.waitForTimeout(700);
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

  const verify = page.locator('button:has-text("Verify")').first();
  if (await verify.isVisible({ timeout: 2_000 }).catch(() => false)) {
    try {
      await verify.click({ timeout: 5_000 });
    } catch {
      /* auto-nav */
    }
  }

  await page.waitForURL((u) => !u.hash.includes('/auth'), { timeout: 30_000 });
}

export async function dismissOpenDialogs(page: Page) {
  for (let i = 0; i < 4; i++) {
    const dialog = page.locator('[role="alertdialog"], [role="dialog"]');
    if (!(await dialog.first().isVisible({ timeout: 600 }).catch(() => false))) return;
    try {
      const cancel = dialog.getByRole('button', { name: /^(Cancel|OK|Got it|Close|Dismiss|Understood)$/i }).first();
      if (await cancel.isVisible({ timeout: 400 }).catch(() => false)) {
        await cancel.click({ force: true, timeout: 3_000 });
        await page.waitForTimeout(350);
        continue;
      }
      const anyBtn = dialog.getByRole('button').first();
      if (await anyBtn.isVisible({ timeout: 300 }).catch(() => false)) {
        await anyBtn.click({ force: true, timeout: 3_000 });
        await page.waitForTimeout(350);
        continue;
      }
    } catch {
      /* dialog closed mid-click */
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(350);
  }
}

export async function goBecomeSeller(page: Page) {
  await page.goto(`${BASE}/#/become-seller`);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1800);
  await dismissOpenDialogs(page);

  // Status screens (approved / pending / reviewing)
  for (let i = 0; i < 3; i++) {
    const hasDraftCard = await page.locator('button:has-text("Continue Setup")').first().isVisible({ timeout: 600 }).catch(() => false);
    if (hasDraftCard) break;
    if (await page.locator('h2:has-text("Your stores")').isVisible({ timeout: 500 }).catch(() => false)) break;

    const addAnother = page.getByRole('button', {
      name: /Add another store|Register Another Category|Choose Different Category/i,
    }).first();
    if (await addAnother.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await addAnother.click();
      await page.waitForTimeout(1000);
      if (await page.getByText(/You already have a store setup in progress/i).isVisible({ timeout: 1_000 }).catch(() => false)) {
        await dismissOpenDialogs(page);
        break;
      }
      continue;
    }
    break;
  }

  await dismissOpenDialogs(page);

  const onStep1 =
    (await page.locator('h2:has-text("Your stores")').isVisible({ timeout: 800 }).catch(() => false)) ||
    (await page.getByText(/What would you like to sell/i).first().isVisible({ timeout: 800 }).catch(() => false));

  if (!onStep1) {
    // Force landing on step 1 (draft recovery surface). Must leave the route
    // so BecomeSeller remounts and checkExisting lands on step 1.
    await page.evaluate(() => {
      try { localStorage.setItem('seller_onboarding_step', '1'); } catch { /* */ }
    });
    await page.goto(`${BASE}/#/`);
    await page.waitForTimeout(400);
    await page.goto(`${BASE}/#/become-seller`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await dismissOpenDialogs(page);
  }
}

export function draftCards(page: Page) {
  return page.locator('text=Setup incomplete').locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
}

export async function activeIncompleteDraftCount(page: Page): Promise<number> {
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('[class*="overflow"]').forEach((el) => {
      try { (el as HTMLElement).scrollTop = 0; } catch { /* */ }
    });
  });
  await page.waitForTimeout(200);
  const panel = page.locator('h2:has-text("Your stores")').locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  if (await panel.isVisible({ timeout: 2_000 }).catch(() => false)) {
    return panel.getByRole('button', { name: /^(Continue Setup|Continuing)/i }).count();
  }
  return page.getByRole('button', { name: /^(Continue Setup|Continuing)/i }).count();
}

/** Delete every incomplete draft shown on Become Seller (clean slate). */
export async function deleteAllIncompleteDrafts(page: Page) {
  await goBecomeSeller(page);
  for (let i = 0; i < 12; i++) {
    await dismissOpenDialogs(page);
    const deleteBtn = page.locator('button:has-text("Delete Draft")').filter({ hasNot: page.locator('[role="alertdialog"] button') }).first();
    // Prefer the text-link Delete Draft on the card (not inside alertdialog)
    const cardDelete = page.locator('div.rounded-xl button:has-text("Delete Draft")').first();
    const target = (await cardDelete.isVisible({ timeout: 800 }).catch(() => false))
      ? cardDelete
      : page.locator('button.text-destructive:has-text("Delete Draft")').first();

    if (!(await target.isVisible({ timeout: 1_500 }).catch(() => false))) break;

    await target.click({ force: true });
    await page.waitForTimeout(500);
    const confirm = page.locator('[role="alertdialog"]').getByRole('button', { name: /^Delete Draft$/ });
    await expect(confirm).toBeVisible({ timeout: 5_000 });
    await confirm.click();
    await page.waitForTimeout(1800);
    await goBecomeSeller(page);
  }
}

/**
 * Start onboarding: enter intent, pick a category in a free parent group, continue.
 * Skips categories that hit "store type already used".
 */
export async function completeStep1Intent(
  page: Page,
  phrase: string,
  preferredCategoryHints: string[] = [
    'Fashion', 'Beauty', 'Jewellery', 'Pet', 'Rental', 'Art', 'Electronics',
    'Sports', 'Music', 'Photography', 'Florist', 'Gift',
  ],
) {
  await goBecomeSeller(page);
  await dismissOpenDialogs(page);
  await expect(page.getByText(/What would you like to sell/i).first()).toBeVisible({ timeout: 15_000 });

  const search = page.locator('input[placeholder*="sell" i], textarea[placeholder*="sell" i], input[placeholder*="Describe" i], input[type="search"]').first();
  if (await search.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await search.fill(phrase);
    await page.waitForTimeout(900);
  }

  const tryContinue = async (): Promise<boolean> => {
    const continueBtn = page.getByRole('button', { name: /^Continue$/ }).first();
    if (!(await continueBtn.isEnabled({ timeout: 3_000 }).catch(() => false))) return false;
    await continueBtn.click();
    await page.waitForTimeout(1500);
    // Blocked by existing store type?
    const blocked = page.getByText(/already have.*store|Store type already used/i);
    if (await blocked.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await dismissOpenDialogs(page);
      return false;
    }
    // Advanced to step 2?
    if (await page.getByText(/Pick a subcategory|subcategor/i).first().isVisible({ timeout: 3_000 }).catch(() => false)) {
      return true;
    }
    return false;
  };

  for (const hint of preferredCategoryHints) {
    if (await search.isVisible({ timeout: 500 }).catch(() => false)) {
      await search.fill(hint);
      await page.waitForTimeout(700);
    }
    const card = page.getByRole('button', { name: new RegExp(hint, 'i') }).first();
    const tile = page.locator(`button, [role="button"], div`).filter({ hasText: new RegExp(`^${hint}`, 'i') }).first();
    if (await card.isVisible({ timeout: 700 }).catch(() => false)) {
      await card.click();
    } else if (await tile.isVisible({ timeout: 500 }).catch(() => false)) {
      await tile.click();
    } else {
      continue;
    }
    await page.waitForTimeout(400);
    if (await tryContinue()) return;
  }

  // Last resort: click any visible category chip/card and continue
  const anyCats = page.locator('button').filter({ hasText: /\w{4,}/ }).filter({ hasNotText: /Continue|Back|Delete|Rename|Add store|Manage|Save/i });
  const n = await anyCats.count();
  for (let i = 0; i < Math.min(n, 12); i++) {
    await anyCats.nth(i).click().catch(() => {});
    await page.waitForTimeout(300);
    if (await tryContinue()) return;
  }

  throw new Error('Could not complete Step 1 — no free category available for this seller');
}

/** Step 2 — pick first subcategory and continue. */
export async function completeStep2Subcategory(page: Page) {
  await dismissOpenDialogs(page);
  await expect(page.getByText(/Pick a subcategory/i).first()).toBeVisible({ timeout: 15_000 });

  // Subcategory grid buttons (2-col) — click first visible option like "Facial"
  const gridBtn = page.locator('div.grid button[type="button"]').first();
  await expect(gridBtn).toBeVisible({ timeout: 10_000 });
  await gridBtn.click();
  await page.waitForTimeout(500);

  const cont = page.getByRole('button', { name: /^Continue$/ }).first();
  await expect(cont).toBeVisible({ timeout: 8_000 });
  await cont.click();
  await page.waitForTimeout(2500);
  await dismissOpenDialogs(page);

  // Must reach listing step (proves draft seller_profiles row exists)
  const onListing = await page.getByText(/Add listing details|Continue to store name|Unable to load your store/i).first()
    .isVisible({ timeout: 12_000 }).catch(() => false);
  if (!onListing) {
    throw new Error(`Step 2 continue did not reach listing. URL=${page.url()} body=${(await page.locator('h1').first().textContent().catch(() => ''))}`);
  }
  if (await page.getByText(/Unable to load your store/i).isVisible({ timeout: 500 }).catch(() => false)) {
    throw new Error('Draft seller id missing after step 2 — store draft was not persisted');
  }
}

/** Ensure we are on listing step (step 3). Seed product may already exist from subcategory. */
export async function ensureOnListingStep(page: Page) {
  const listingHeader = page.getByText(/Add listing details|listing|product|service/i).first();
  await expect(listingHeader).toBeVisible({ timeout: 20_000 });
}

export async function clickContinueSetup(page: Page) {
  const btn = page.getByRole('button', { name: /^(Continue Setup|Continuing)/i }).first();
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await btn.click();
  await page.waitForTimeout(1500);
}

export async function openRenameDialog(page: Page) {
  await page.locator('button:has-text("Rename")').first().click();
  await expect(page.getByRole('dialog').or(page.getByText('Rename store'))).toBeVisible({ timeout: 5_000 });
}

export async function renameDraft(page: Page, name: string) {
  await openRenameDialog(page);
  const input = page.locator('input[placeholder*="Kitchen" i], input[maxlength="80"]').last();
  await input.fill(name);
  await page.getByRole('button', { name: /Save name/i }).click();
  await page.waitForTimeout(1500);
}

export async function deleteDraftWithConfirm(page: Page) {
  await page.locator('button:has-text("Delete Draft")').first().click();
  await expect(page.getByText(/Delete this unfinished store/i)).toBeVisible({ timeout: 5_000 });
  await page.getByRole('button', { name: /^Delete Draft$/ }).last().click();
  await page.waitForTimeout(2000);
}

export async function clickAddStoreNewCategory(page: Page) {
  await page.getByRole('button', { name: /Add store in a new category/i }).click();
  await page.waitForTimeout(800);
}

export async function expectOneDraftGate(page: Page) {
  await expect(page.getByText(/You already have a store setup in progress/i)).toBeVisible({ timeout: 8_000 });
}

export async function fillStoreNameAndSubmit(page: Page, storeName: string) {
  // Navigate to store step if on listing
  const toStore = page.getByRole('button', { name: /Continue to store name/i }).first();
  if (await toStore.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // Need at least one product — DraftProductManager may have seeded one
    await toStore.click();
    await page.waitForTimeout(1500);
  }

  await expect(page.getByText(/Name your store/i).first()).toBeVisible({ timeout: 15_000 });
  const nameInput = page.locator('input').filter({ hasNot: page.locator('[type="checkbox"]') }).first();
  // Prefer labeled business name
  const biz = page.locator('input[placeholder*="store" i], input[name*="business" i]').first();
  if (await biz.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await biz.fill(storeName);
  } else {
    // First large text input on step 4
    const inputs = page.locator('input[type="text"]');
    await inputs.first().fill(storeName);
  }

  const declaration = page.locator('button[role="checkbox"], [role="checkbox"]').last();
  if (await declaration.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const state = await declaration.getAttribute('data-state');
    if (state !== 'checked') await declaration.click();
  }

  const submit = page.getByRole('button', { name: /Submit for review/i }).first();
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await submit.click();
  await page.waitForTimeout(3000);
}
