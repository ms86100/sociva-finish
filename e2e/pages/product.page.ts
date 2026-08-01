import { type Page, expect } from '@playwright/test';

/**
 * Product Detail Page Object
 */
export class ProductPage {
  constructor(private page: Page) {}

  async goto(productId: string) {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/product/${productId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async waitForLoaded() {
    // Wait for product title or image to appear
    await this.page.locator('h1, h2, [data-testid="product-title"]').first()
      .waitFor({ state: 'visible', timeout: 15_000 });
  }

  async addToCart() {
    const addBtn = this.page.locator(
      'button:has-text("Add to Cart"), button:has-text("Add"), button:has-text("ADD")'
    ).first();
    await addBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await addBtn.click();

    // Wait for cart update confirmation (toast or counter change)
    await this.page.waitForTimeout(1_000);
  }

  async getStockCount(): Promise<string | null> {
    const stock = this.page.locator('[data-testid="stock-count"], .stock-count, :text("in stock")').first();
    if (await stock.isVisible({ timeout: 3_000 }).catch(() => false)) {
      return stock.textContent();
    }
    return null;
  }

  async getProductName(): Promise<string> {
    const title = this.page.locator('h1, h2, [data-testid="product-title"]').first();
    return (await title.textContent()) || '';
  }
}
