import { type Page, expect } from '@playwright/test';

/**
 * Seller Dashboard Page Object
 */
export class SellerPage {
  constructor(private page: Page) {}

  async gotoOrders() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/orders`);
    await this.page.waitForLoadState('networkidle');

    // Switch to "Selling" / "Received" tab
    const sellingTab = this.page.locator(
      'button:has-text("Selling"), button:has-text("Received"), [data-testid="selling-tab"]'
    ).first();
    if (await sellingTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await sellingTab.click();
      await this.page.waitForLoadState('networkidle');
    }
  }

  async findOrder(orderId: string) {
    const order = this.page.locator(`[data-order-id="${orderId}"], a[href*="${orderId}"]`).first();
    if (await order.isVisible({ timeout: 10_000 }).catch(() => false)) {
      return order;
    }

    // Try text search
    const orderText = this.page.locator(`:text("${orderId.substring(0, 8)}")`).first();
    return orderText;
  }

  async updateOrderStatus(orderId: string, status: string) {
    // Navigate to order detail
    const order = await this.findOrder(orderId);
    await order.click();
    await this.page.waitForLoadState('networkidle');

    // Click status update button
    const statusBtn = this.page.locator(
      `button:has-text("${status}"), button:has-text("Accept"), button:has-text("Ready"), button:has-text("Mark")`
    ).first();
    await statusBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await statusBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  async getReceivedOrders() {
    const orders = this.page.locator('[data-testid="order-card"], .order-card');
    return orders;
  }

  async gotoProducts() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/seller/products`);
    await this.page.waitForLoadState('networkidle');
  }
}
