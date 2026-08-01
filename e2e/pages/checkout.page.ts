import { type Page, expect } from '@playwright/test';

/**
 * Checkout Page Object
 */
export class CheckoutPage {
  constructor(private page: Page) {}

  async selectCOD() {
    const codOption = this.page.locator(
      'button:has-text("COD"), button:has-text("Cash on Delivery"), [data-testid="cod-option"], label:has-text("COD")'
    ).first();
    await codOption.waitFor({ state: 'visible', timeout: 10_000 });
    await codOption.click();
  }

  async selectRazorpay() {
    const razorpayOption = this.page.locator(
      'button:has-text("Pay Online"), button:has-text("Razorpay"), button:has-text("UPI"), [data-testid="online-payment"]'
    ).first();
    await razorpayOption.waitFor({ state: 'visible', timeout: 10_000 });
    await razorpayOption.click();
  }

  async placeOrder() {
    const placeBtn = this.page.locator(
      'button:has-text("Place Order"), button:has-text("Confirm"), button:has-text("Pay")'
    ).first();
    await placeBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await placeBtn.click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Extract order ID from the success/confirmation page URL or content.
   */
  async getOrderId(): Promise<string> {
    // Wait for redirect to order page or success page
    await this.page.waitForURL((url) => 
      url.hash.includes('/order') || url.hash.includes('/success'),
      { timeout: 15_000 }
    ).catch(() => {});

    // Try to get order ID from URL
    const url = this.page.url();
    const urlMatch = url.match(/order[s]?\/([a-f0-9-]+)/i);
    if (urlMatch) return urlMatch[1];

    // Try to get from page content
    const orderIdEl = this.page.locator('[data-testid="order-id"], .order-id').first();
    if (await orderIdEl.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const text = await orderIdEl.textContent();
      const match = text?.match(/([a-f0-9-]{36})/i);
      if (match) return match[1];
    }

    throw new Error('Could not extract order ID from page');
  }

  async isProcessing(): Promise<boolean> {
    const spinner = this.page.locator('.animate-spin, [data-testid="loading"], :text("Processing")').first();
    return spinner.isVisible({ timeout: 2_000 }).catch(() => false);
  }
}
