import { test, expect } from '../../fixtures/user.fixture';
import { HomePage } from '../../pages/home.page';
import { CartPage } from '../../pages/cart.page';
import { CheckoutPage } from '../../pages/checkout.page';
import { assertSingleOrder } from '../../utils/db-helpers';
import { testTimestamp } from '../../utils/test-data';

test.describe('Idempotency Tests @critical', () => {
  test('double-click checkout creates only 1 order', async ({ buyerPage, db }) => {
    const startTime = testTimestamp();

    const home = new HomePage(buyerPage);
    await home.navigateToMarketplace();
    await home.clickFirstProduct();

    await buyerPage.locator(
      'button:has-text("Add to Cart"), button:has-text("Add"), button:has-text("ADD")'
    ).first().click();
    await buyerPage.waitForTimeout(1_000);

    const cart = new CartPage(buyerPage);
    await cart.goto();
    await cart.proceedToCheckout();

    const checkout = new CheckoutPage(buyerPage);
    await checkout.selectCOD();

    // RAPID DOUBLE CLICK on Place Order
    const placeBtn = buyerPage.locator(
      'button:has-text("Place Order"), button:has-text("Confirm")'
    ).first();
    await placeBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Click twice rapidly without waiting
    await placeBtn.click({ delay: 0 });
    await placeBtn.click({ delay: 0 }).catch(() => {});

    // Wait for order processing
    await buyerPage.waitForTimeout(5_000);

    // DB VALIDATION: Get buyer's session to find user ID
    // Check orders created after startTime
    const { data: session } = await db.auth.getSession();
    if (session?.session?.user?.id) {
      const orders = await assertSingleOrder(db, session.session.user.id, startTime);
      // Should have at most 1 order
      expect(orders.length).toBeLessThanOrEqual(1);
    }
  });
});
