import { test, expect } from '@playwright/test';
import { loginPhone, shot, advanceCarousel } from './helpers';

/** Pre-seeded via SQL: Hands Cut & File (book) + Bridal & Party Makeup (contact_seller). */
const SERVICE_ID = process.env.E2E_SERVICE_PRODUCT_ID || '63bdf93f-2976-4009-904c-2ab76c9eba09';
const LISTING_ID = process.env.E2E_LISTING_PRODUCT_ID || '867026f9-0459-4c5b-9be8-0a4363795d78';

async function openBuyerCarousel(
  page: import('@playwright/test').Page,
  productId: string,
  area: string,
  prefix: string,
) {
  await loginPhone(page, '9876543201', '1234');
  const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
  await page.goto(`${base}/#/product/${productId}`);
  await page.waitForTimeout(2_500);
  await shot(page, area, `${prefix}-01-opened`);

  // Geo gate should be cleared by seeded Bangalore browsing location
  await expect(page.getByText(/not available in your area/i)).toHaveCount(0);
  await expect(page.locator('text=/\\d+\\/\\d+/').first()).toBeVisible({ timeout: 12_000 });
  await shot(page, area, `${prefix}-02-indicator`);

  await advanceCarousel(page, 1);
  await shot(page, area, `${prefix}-03-after-advance`);
  await expect(page.locator('text=/[2-5]\\/\\d+/').first()).toBeVisible({ timeout: 5_000 });
}

test.describe('Service + Listing buyer multi-image @critical @buyer-carousel', () => {
  test('S-BUYER — service book carousel (Hands Cut & File)', async ({ page }) => {
    await openBuyerCarousel(page, SERVICE_ID, 'service', 'SERVICE-BUYER');
  });

  test('L-BUYER — contact listing carousel (Bridal Makeup)', async ({ page }) => {
    await openBuyerCarousel(page, LISTING_ID, 'listing', 'LISTING-BUYER');
  });
});
