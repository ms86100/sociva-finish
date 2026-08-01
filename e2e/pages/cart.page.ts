import { type Page, expect } from '@playwright/test';

/**
 * Cart Page Object
 */
export class CartPage {
  constructor(private page: Page) {}

  async goto() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/cart`);
    await this.page.waitForLoadState('networkidle');
  }

  async getItemCount(): Promise<number> {
    const items = this.page.locator('[data-testid="cart-item"], .cart-item');
    return items.count();
  }

  async getCartTotal(): Promise<string> {
    const total = this.page.locator('[data-testid="cart-total"], .cart-total, :text("Total")').first();
    return (await total.textContent()) || '0';
  }

  async removeItem(index: number) {
    const removeBtn = this.page.locator('button:has-text("Remove"), button[aria-label="Remove"]').nth(index);
    await removeBtn.click();
    await this.page.waitForTimeout(500);
  }

  async proceedToCheckout() {
    const checkoutBtn = this.page.locator(
      'button:has-text("Checkout"), button:has-text("Proceed"), button:has-text("Place Order"), a:has-text("Checkout")'
    ).first();
    await checkoutBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await checkoutBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  async isEmpty(): Promise<boolean> {
    const emptyMsg = this.page.locator(':text("empty"), :text("no items"), :text("Cart is empty")').first();
    return emptyMsg.isVisible({ timeout: 3_000 }).catch(() => false);
  }
}
