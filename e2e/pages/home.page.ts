import { type Page, expect } from '@playwright/test';

/**
 * Home / Marketplace Page Object
 */
export class HomePage {
  constructor(private page: Page) {}

  async goto() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/`);
    await this.page.waitForLoadState('networkidle');
  }

  async navigateToMarketplace() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/marketplace`);
    await this.page.waitForLoadState('networkidle');
  }

  async searchProduct(name: string) {
    const searchInput = this.page.locator('input[placeholder*="Search"], input[type="search"]').first();
    if (await searchInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await searchInput.fill(name);
      await this.page.keyboard.press('Enter');
      await this.page.waitForLoadState('networkidle');
    }
  }

  async getFirstProduct() {
    const product = this.page.locator('[data-testid="product-card"], .product-card, a[href*="product"]').first();
    await product.waitFor({ state: 'visible', timeout: 10_000 });
    return product;
  }

  async clickFirstProduct() {
    const product = await this.getFirstProduct();
    await product.click();
    await this.page.waitForLoadState('networkidle');
  }
}
