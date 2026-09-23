import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  IMAGES,
  shot,
  loginPhone,
  uploadOfferingPhoto,
  galleryPreviewCount,
  fillMinimalProduct,
  goToNewProduct,
  saveProductForm,
  submitDraftIfVisible,
  advanceCarousel,
  EVIDENCE_ROOT,
} from './helpers';

const stamp = Date.now().toString().slice(-6);
const PRODUCT_NAME = `Test Product — Multi Image ${stamp}`;
const META_PATH = path.join(EVIDENCE_ROOT, 'report', 'last-published.json');

test.describe.configure({ mode: 'serial' });

test.describe('Product publish → buyer multi-image @critical', () => {
  test('PUB-01 create product with 3 images through wizard', async ({ page }) => {
    await loginPhone(page);
    await goToNewProduct(page);
    await fillMinimalProduct(page, PRODUCT_NAME);
    for (let i = 1; i <= 3; i++) {
      await uploadOfferingPhoto(page, IMAGES[i as 1 | 2 | 3]);
    }
    expect(await galleryPreviewCount(page)).toBe(3);
    await shot(page, 'product', 'PRODUCT-PUB-01-three-before-save');

    await saveProductForm(page, '149');
    await shot(page, 'product', 'PRODUCT-PUB-02-after-wizard');

    const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/#/seller/products`);
    await page.waitForTimeout(2_000);
    await expect(page.getByText(PRODUCT_NAME, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await shot(page, 'product', 'PRODUCT-PUB-03-in-list');
    await submitDraftIfVisible(page, PRODUCT_NAME);

    fs.mkdirSync(path.dirname(META_PATH), { recursive: true });
    fs.writeFileSync(
      META_PATH,
      JSON.stringify({ name: PRODUCT_NAME, stamp, createdAt: new Date().toISOString() }, null, 2),
    );
  });

  test('PUB-02 buyer carousel after approval', async ({ page }) => {
    let productId = process.env.E2E_PUBLISHED_PRODUCT_ID || '';
    if (!productId && fs.existsSync(META_PATH)) {
      const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as { productId?: string; name?: string };
      productId = meta.productId || '';
    }
    test.skip(!productId, 'Set E2E_PUBLISHED_PRODUCT_ID (or last-published.json productId) after DB approve');

    await loginPhone(page, '9876543201', '1234');
    const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
    await page.goto(`${base}/#/product/${productId}`);
    await page.waitForTimeout(2_500);
    await shot(page, 'buyer', 'PRODUCT-PUB-04-buyer-detail');

    const indicator = page.locator('text=/\\d+\\/\\d+/').first();
    await expect(indicator).toBeVisible({ timeout: 12_000 });
    await shot(page, 'buyer', 'PRODUCT-PUB-05-carousel-indicator');

    await advanceCarousel(page, 1);
    await shot(page, 'buyer', 'PRODUCT-PUB-06-after-swipe');
    await expect(page.locator('text=/[2-5]\\/\\d+/').first()).toBeVisible({ timeout: 5_000 });
  });
});
