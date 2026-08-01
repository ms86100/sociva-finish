import { type Page, expect } from '@playwright/test';

/**
 * Order Detail / List Page Object
 */
export class OrderPage {
  constructor(private page: Page) {}

  async goto(orderId: string) {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/orders/${orderId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async gotoList() {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await this.page.goto(`${baseURL}/#/orders`);
    await this.page.waitForLoadState('networkidle');
  }

  async getStatus(): Promise<string> {
    const status = this.page.locator(
      '[data-testid="order-status"], .order-status, .badge'
    ).first();
    await status.waitFor({ state: 'visible', timeout: 10_000 });
    return (await status.textContent()) || '';
  }

  async waitForStatus(expectedStatus: string, timeoutMs = 15_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = await this.getStatus();
      if (current.toLowerCase().includes(expectedStatus.toLowerCase())) {
        return;
      }
      await this.page.reload();
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(2_000);
    }
    throw new Error(`Order status did not reach "${expectedStatus}" within ${timeoutMs}ms`);
  }

  async getOrderDetails() {
    return {
      status: await this.getStatus(),
      url: this.page.url(),
    };
  }
}
