import { test, expect } from '@playwright/test';
import {
  IMAGES,
  shot,
  loginPhone,
  uploadOfferingPhoto,
  galleryPreviewCount,
  fillMinimalProduct,
  goToNewProduct,
} from './helpers';

/**
 * Gallery-focused seller E2E — asserts 1–5 upload/delete/max without requiring
 * full wizard publish (publish covered separately / flaky on multi-step forms).
 */
test.describe.configure({ mode: 'serial' });

test.describe('Seller gallery controls @critical @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await loginPhone(page);
    await goToNewProduct(page);
  });

  test('G01 — form shows Add up to 5 photos', async ({ page }) => {
    await expect(page.getByText(/add up to 5 photos/i).first()).toBeVisible();
    await expect(page.getByText(/photos \*/i).first()).toBeVisible();
    await shot(page, 'product', 'PRODUCT-G01-add-up-to-5-copy');
  });

  test('G02 — upload 1 image shows cover', async ({ page }) => {
    await fillMinimalProduct(page, 'Test Product — Multi Image G02');
    await uploadOfferingPhoto(page, IMAGES[1]);
    expect(await galleryPreviewCount(page)).toBe(1);
    await expect(page.getByText(/cover/i).first()).toBeVisible();
    await shot(page, 'product', 'PRODUCT-G02-one-image');
  });

  test('G03 — upload 3 images', async ({ page }) => {
    await fillMinimalProduct(page, 'Test Product — Multi Image G03');
    for (let i = 1; i <= 3; i++) {
      await uploadOfferingPhoto(page, IMAGES[i as 1 | 2 | 3]);
    }
    expect(await galleryPreviewCount(page)).toBe(3);
    await shot(page, 'product', 'PRODUCT-G03-three-images');
  });

  test('G04 — five images then no Add slot (P03/P04)', async ({ page }) => {
    await fillMinimalProduct(page, 'Test Product — Multi Image G04');
    for (let i = 1; i <= 5; i++) {
      await uploadOfferingPhoto(page, IMAGES[i as 1 | 2 | 3 | 4 | 5]);
    }
    expect(await galleryPreviewCount(page)).toBe(5);
    await expect(page.locator('#edit-prod-image_url button[aria-label="Add photo"]')).toHaveCount(0);
    await shot(page, 'product', 'PRODUCT-G04-five-images-max');
  });

  test('G05 — cannot delete final image (P06)', async ({ page }) => {
    await fillMinimalProduct(page, 'Test Product — Multi Image G05');
    await uploadOfferingPhoto(page, IMAGES[1]);
    await page.locator('#edit-prod-image_url button[aria-label="Remove photo"]').first().click();
    await expect(page.locator('text=/at least 1|at least one/i').first()).toBeVisible({ timeout: 5_000 });
    expect(await galleryPreviewCount(page)).toBe(1);
    await shot(page, 'product', 'PRODUCT-G05-final-image-protection');
  });

  test('G06 — delete middle image (P05)', async ({ page }) => {
    await fillMinimalProduct(page, 'Test Product — Multi Image G06');
    for (let i = 1; i <= 3; i++) {
      await uploadOfferingPhoto(page, IMAGES[i as 1 | 2 | 3]);
    }
    await shot(page, 'product', 'PRODUCT-G06-before-delete');
    await page.locator('#edit-prod-image_url button[aria-label="Remove photo"]').nth(1).click();
    await page.waitForTimeout(400);
    expect(await galleryPreviewCount(page)).toBe(2);
    await shot(page, 'product', 'PRODUCT-G06-after-delete');
  });
});
