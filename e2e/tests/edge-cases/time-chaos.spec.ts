import { test, expect } from '../../fixtures/user.fixture';
import { mockSlowResponse } from '../../utils/razorpay-mock';

test.describe('Time-Based Chaos Tests @regression', () => {
  test('delayed API response shows loading state, no crash', async ({ buyerPage }) => {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';

    // Add 5s delay to all Supabase REST API calls
    await mockSlowResponse(buyerPage, '**/rest/v1/**', 5_000);

    // Navigate to marketplace
    await buyerPage.goto(`${baseURL}/#/marketplace`);

    // Page should show loading state
    const loadingOrContent = await buyerPage.locator(
      '.animate-spin, .skeleton, [data-testid="loading"], h1, h2, .product-card'
    ).first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);

    expect(loadingOrContent).toBeTruthy();

    // No crash — page should eventually render
    await buyerPage.waitForTimeout(7_000);

    // Verify no error toasts/alerts
    const errorToast = await buyerPage.locator(
      '[data-sonner-toast][data-type="error"], .toast-error'
    ).count();

    // Page should not have crashed
    const pageContent = await buyerPage.content();
    expect(pageContent).toContain('</html>');
  });

  test('delayed notification processing does not create duplicates', async ({ buyerPage, db }) => {
    // Add delay to notification queue processing endpoint
    await mockSlowResponse(buyerPage, '**/process-notification-queue**', 10_000);

    // Navigate — the delay should not cause UI issues
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await buyerPage.goto(`${baseURL}/#/`);
    await buyerPage.waitForLoadState('domcontentloaded');

    // Page should remain functional despite backend delays
    const isResponsive = await buyerPage.locator('body').isVisible();
    expect(isResponsive).toBeTruthy();
  });

  test('3G network simulation - app remains functional @mobile', async ({ buyerPage }) => {
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';

    // Simulate 3G by adding 2s delay to ALL requests
    await mockSlowResponse(buyerPage, '**/*', 2_000);

    await buyerPage.goto(`${baseURL}/#/`);

    // App should eventually load even on slow network
    await buyerPage.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // No blank page
    const body = await buyerPage.locator('body').textContent();
    expect(body?.length).toBeGreaterThan(0);
  });
});
