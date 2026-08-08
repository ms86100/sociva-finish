import { expect, test } from '@playwright/test';

test.describe('Buyer discovery @discovery-smoke', () => {
  test('loads the public search experience', async ({ page }) => {
    const response = await page.goto('/#/search', { waitUntil: 'domcontentloaded' });

    expect(response, 'search navigation should return a document response').not.toBeNull();
    expect(response?.ok(), `search returned HTTP ${response?.status()}`).toBe(true);
    await expect(page).toHaveURL(/#\/search(?:[?]|$)/);

    const searchInput = page.locator('input:not([type="tel"])').first();
    const authInput = page.getByRole('textbox', { name: 'Phone Number' });
    await expect
      .poll(async () => (await searchInput.count()) + (await authInput.count()))
      .toBeGreaterThan(0);

    if (await searchInput.count()) {
      await expect(searchInput).toBeVisible();
      await expect(page.getByRole('button', { name: 'Top Rated', exact: true })).toBeVisible();
    } else {
      await expect(authInput).toHaveCount(1);
    }
  });

  test('preserves the URL term and hydrates it when discovery is accessible', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'URL hydration is covered once on desktop; mobile runs the route smoke.');

    const term = 'fresh paneer';
    await page.goto(`/#/search?q=${encodeURIComponent(term)}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(
      new RegExp(`#\\/search\\?q=${encodeURIComponent(term)}(?:&|$)`),
    );

    const searchInput = page.locator('input:not([type="tel"])').first();
    const authInput = page.getByRole('textbox', { name: 'Phone Number' });
    await expect
      .poll(async () => (await searchInput.count()) + (await authInput.count()))
      .toBeGreaterThan(0);

    if (await searchInput.count()) {
      await expect(searchInput).toHaveValue(term);
    } else {
      await expect(authInput).toHaveCount(1);
    }
  });
});
