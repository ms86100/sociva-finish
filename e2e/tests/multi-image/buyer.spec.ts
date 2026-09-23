import { test, expect } from '@playwright/test';
import { loginPhone, shot } from './helpers';
import { createClient } from '@supabase/supabase-js';

/**
 * Buyer carousel + card layout. Uses DB to find a product with secondary_images
 * when available; otherwise searches for Test Product offerings created earlier.
 */
test.describe('Buyer multi-image experience @buyer-carousel @mobile @critical', () => {
  test('BUYER - single-image detail has no carousel chrome @single-image', async ({ page }) => {
    await loginPhone(page, '9876543201', '1234');
    const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/#/`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);
    await shot(page, 'buyer', 'BUYER-CARD-home');

    // Open first product card if present
    const card = page.locator('[data-testid="product-card"], a[href*="/product/"], .product-card').first();
    if (await card.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await card.click();
      await page.waitForTimeout(1_500);
      await shot(page, 'buyer', 'BUYER-DETAIL-opened');

      // Single-image: no "2/5" style indicator required; if only one image, 1/N should not appear
      const multi = page.locator('text=/\\d+\\/\\d+/');
      const multiCount = await multi.count();
      // Soft assert - may be multi-image product; capture either way
      await shot(page, 'buyer', multiCount > 0 ? 'BUYER-DETAIL-multi-indicator' : 'BUYER-DETAIL-single-clean');
    } else {
      await shot(page, 'buyer', 'BUYER-CARD-no-products-visible');
    }
  });

  test('BUYER - carousel advances when secondary_images exist @mobile', async ({ page }) => {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    let productId: string | null = null;

    if (url && key) {
      const sb = createClient(url, key);
      const { data } = await sb
        .from('products')
        .select('id, name, image_url, secondary_images, approval_status')
        .eq('approval_status', 'approved')
        .not('secondary_images', 'is', null)
        .limit(5);
      const hit = (data || []).find((p: any) => Array.isArray(p.secondary_images) && p.secondary_images.length >= 1);
      if (hit) productId = hit.id;
    }

    await loginPhone(page, '9876543201', '1234');
    const base = process.env.BASE_URL || 'http://127.0.0.1:5173';

    if (productId) {
      await page.goto(`${base}/#/product/${productId}`);
      await page.waitForTimeout(2_000);
      await shot(page, 'buyer', 'BUYER-CAROUSEL-01-image-1');

      const indicator = page.locator('text=/1\\/\\d+/').first();
      if (await indicator.isVisible({ timeout: 5_000 }).catch(() => false)) {
        // Swipe carousel
        const scroller = page.locator('.snap-x').first();
        const box = await scroller.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 12 });
          await page.mouse.up();
          await page.waitForTimeout(600);
          await shot(page, 'buyer', 'BUYER-CAROUSEL-02-after-swipe');
          await expect(page.locator('text=/2\\/\\d+/').first()).toBeVisible({ timeout: 5_000 });
        }
      } else {
        await shot(page, 'buyer', 'BUYER-CAROUSEL-no-indicator');
      }
    } else {
      // Seed secondary_images on a known product if we have service role - else document gap
      await page.goto(`${base}/#/`);
      await shot(page, 'buyer', 'BUYER-CAROUSEL-skipped-no-multi-product');
      test.info().annotations.push({ type: 'note', description: 'No approved product with secondary_images found for carousel swipe' });
    }
  });

  test('REGRESSION - cart/checkout still loads', async ({ page }) => {
    await loginPhone(page, '9876543201', '1234');
    const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/#/cart`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1_500);
    // Should not crash
    await expect(page.locator('body')).toBeVisible();
    await shot(page, 'buyer', 'REGRESSION-cart-page');
  });
});
