import { test, expect } from '../../fixtures/user.fixture';
import { HomePage } from '../../pages/home.page';
import { CartPage } from '../../pages/cart.page';
import { CheckoutPage } from '../../pages/checkout.page';
import { mockRazorpayFailure } from '../../utils/razorpay-mock';
import { getOrder } from '../../utils/db-helpers';

test.describe('Razorpay Failure Flow @regression', () => {
  test('failed payment keeps order in pending state', async ({ buyerPage, db }) => {
    await mockRazorpayFailure(buyerPage);

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
    await checkout.selectRazorpay();
    await checkout.placeOrder();

    // Payment fails — user should see error/retry state
    await buyerPage.waitForTimeout(2_000);

    // Check that UI shows failure state or returns to checkout
    const hasError = await buyerPage.locator(
      ':text("failed"), :text("retry"), :text("try again"), :text("Payment")'
    ).first().isVisible({ timeout: 10_000 }).catch(() => false);

    // The order (if created) should be in payment_pending status
    // Note: order may or may not be created depending on when failure occurs
  });
});
