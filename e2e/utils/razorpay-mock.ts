import { type Page } from '@playwright/test';

/**
 * Razorpay route interception utilities for E2E testing.
 * Intercepts Razorpay SDK script load and API calls.
 */

/**
 * Mock Razorpay successful payment flow.
 * Intercepts the SDK script and simulates a successful payment callback.
 */
export async function mockRazorpaySuccess(page: Page) {
  // Intercept Razorpay checkout script
  await page.route('**/checkout.razorpay.com/**', async (route) => {
    if (route.request().resourceType() === 'script') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.Razorpay = function(options) {
            this.open = function() {
              setTimeout(function() {
                options.handler({
                  razorpay_payment_id: 'pay_test_' + Date.now(),
                  razorpay_order_id: options.order_id || 'order_test_' + Date.now(),
                  razorpay_signature: 'mock_signature_' + Date.now()
                });
              }, 500);
            };
            this.close = function() {};
            this.on = function() {};
          };
        `,
      });
    } else {
      await route.continue();
    }
  });

  // Intercept Razorpay API calls
  await page.route('**/api.razorpay.com/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'captured' }),
    });
  });
}

/**
 * Mock Razorpay payment failure.
 */
export async function mockRazorpayFailure(page: Page) {
  await page.route('**/checkout.razorpay.com/**', async (route) => {
    if (route.request().resourceType() === 'script') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.Razorpay = function(options) {
            this.open = function() {
              setTimeout(function() {
                if (options.modal && options.modal.ondismiss) {
                  options.modal.ondismiss();
                }
              }, 500);
            };
            this.close = function() {};
            this.on = function() {};
          };
        `,
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock Razorpay with delayed callback (simulates slow response).
 */
export async function mockRazorpayDelayedCallback(page: Page, delayMs = 10_000) {
  await page.route('**/checkout.razorpay.com/**', async (route) => {
    if (route.request().resourceType() === 'script') {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.Razorpay = function(options) {
            this.open = function() {
              setTimeout(function() {
                options.handler({
                  razorpay_payment_id: 'pay_delayed_' + Date.now(),
                  razorpay_order_id: options.order_id || 'order_delayed',
                  razorpay_signature: 'mock_sig_delayed'
                });
              }, ${delayMs});
            };
            this.close = function() {};
            this.on = function() {};
          };
        `,
      });
    } else {
      await route.continue();
    }
  });
}

/**
 * Mock a network drop after payment appears to succeed.
 * Razorpay handler fires but confirmation API call fails.
 */
export async function mockNetworkDropAfterPayment(page: Page) {
  await mockRazorpaySuccess(page);

  // Block the confirmation edge function call
  await page.route('**/confirm-razorpay-payment**', async (route) => {
    await route.abort('connectionfailed');
  });
}

/**
 * Add artificial delay to any route (for 3G simulation).
 */
export async function mockSlowResponse(page: Page, urlPattern: string, delayMs: number) {
  await page.route(urlPattern, async (route) => {
    await new Promise((r) => setTimeout(r, delayMs));
    await route.continue();
  });
}
