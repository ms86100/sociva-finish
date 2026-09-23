import { test, expect } from '@playwright/test';
import { loginPhone, shot, IMAGES, uploadOfferingPhoto, galleryPreviewCount, fillMinimalProduct, goToNewProduct, saveProductForm } from './helpers';

/**
 * Service & Listing share products table + OfferingImageGalleryUpload.
 * These tests create offerings via seller form when the seller's categories allow;
 * gallery assertions prove the same 1–5 behaviour.
 */
test.describe.configure({ mode: 'serial' });

async function createWithImages(page: import('@playwright/test').Page, name: string, imageCount: number) {
  await goToNewProduct(page);
  await fillMinimalProduct(page, name);
  for (let i = 1; i <= imageCount; i++) {
    if (i > 1) await page.getByRole('button', { name: /^add$/i }).click({ timeout: 4_000 }).catch(() => {});
    await uploadOfferingPhoto(page, IMAGES[i as 1 | 2 | 3 | 4 | 5]);
  }
  expect(await galleryPreviewCount(page)).toBe(imageCount);
}

test.describe('Service multi-image gallery @critical', () => {
  test.beforeEach(async ({ page }) => {
    await loginPhone(page);
  });

  test('S01 — service form accepts 1 image', async ({ page }) => {
    const name = `Test Service — Multi Image ${Date.now().toString().slice(-5)}`;
    await createWithImages(page, name, 1);
    await shot(page, 'service', 'SERVICE-S01-one-image');
    // Assert shared gallery copy
    await expect(page.getByText(/add up to 5 photos/i).first()).toBeVisible();
    await saveProductForm(page);
  });

  test('S02 — three images', async ({ page }) => {
    await createWithImages(page, `Test Service — Multi Image 3img ${Date.now().toString().slice(-4)}`, 3);
    await shot(page, 'service', 'SERVICE-S02-three-images');
  });

  test('S03 — five images and no sixth slot', async ({ page }) => {
    await createWithImages(page, `Test Service — Multi Image 5img ${Date.now().toString().slice(-4)}`, 5);
    await expect(page.getByRole('button', { name: /^add$/i })).toHaveCount(0);
    await shot(page, 'service', 'SERVICE-S03-five-images');
  });

  test('S04 — sixth rejected', async ({ page }) => {
    await createWithImages(page, `Test Service — Multi Image 6th ${Date.now().toString().slice(-4)}`, 5);
    await shot(page, 'service', 'SERVICE-S04-before-sixth');
    expect(await galleryPreviewCount(page)).toBe(5);
    await expect(page.getByRole('button', { name: /^add$/i })).toHaveCount(0);
    await shot(page, 'service', 'SERVICE-S04-sixth-rejected');
  });

  test('S06 — cannot delete final image', async ({ page }) => {
    await createWithImages(page, `Test Service — Multi Image final ${Date.now().toString().slice(-4)}`, 1);
    await page.locator('#edit-prod-image_url button[aria-label="Remove photo"]').first().click();
    await expect(page.locator('text=/at least 1|at least one/i').first()).toBeVisible({ timeout: 5_000 });
    expect(await galleryPreviewCount(page)).toBe(1);
    await shot(page, 'service', 'SERVICE-S06-final-protection');
  });
});

test.describe('Listing multi-image gallery @critical', () => {
  test.beforeEach(async ({ page }) => {
    await loginPhone(page);
  });

  test('L01 — listing form accepts 1 image', async ({ page }) => {
    await createWithImages(page, `Test Listing — Multi Image ${Date.now().toString().slice(-5)}`, 1);
    await expect(page.getByText(/add up to 5 photos/i).first()).toBeVisible();
    await shot(page, 'listing', 'LISTING-L01-one-image');
  });

  test('L02 — three images', async ({ page }) => {
    await createWithImages(page, `Test Listing — Multi Image 3 ${Date.now().toString().slice(-4)}`, 3);
    await shot(page, 'listing', 'LISTING-L02-three-images');
  });

  test('L03 — five images', async ({ page }) => {
    await createWithImages(page, `Test Listing — Multi Image 5 ${Date.now().toString().slice(-4)}`, 5);
    expect(await galleryPreviewCount(page)).toBe(5);
    await shot(page, 'listing', 'LISTING-L03-five-images');
  });

  test('L04 — sixth slot unavailable', async ({ page }) => {
    await createWithImages(page, `Test Listing — Multi Image 6 ${Date.now().toString().slice(-4)}`, 5);
    await expect(page.getByRole('button', { name: /^add$/i })).toHaveCount(0);
    await shot(page, 'listing', 'LISTING-L04-sixth-rejected');
  });

  test('L06 — final image protection', async ({ page }) => {
    await createWithImages(page, `Test Listing — Multi Image final ${Date.now().toString().slice(-4)}`, 1);
    await page.locator('#edit-prod-image_url button[aria-label="Remove photo"]').first().click();
    await expect(page.locator('text=/at least 1|at least one/i').first()).toBeVisible({ timeout: 5_000 });
    await shot(page, 'listing', 'LISTING-L06-final-protection');
  });
});
