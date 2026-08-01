import { test, expect } from '../../fixtures/user.fixture';
import { HomePage } from '../../pages/home.page';
import { CartPage } from '../../pages/cart.page';
import { CheckoutPage } from '../../pages/checkout.page';
import { mockRazorpaySuccess } from '../../utils/razorpay-mock';
import { getOrder, getPaymentRecord } from '../../utils/db-helpers';

test.describe('Razorpay Success Flow @critical', () => {
  test('successful online payment creates exactly 1 payment record', async ({ buyerPage, db }) => {
    // Set up Razorpay mock BEFORE navigation
    await mockRazorpaySuccess(buyerPage);

    // Navigate and add product
    const home = new HomePage(buyerPage);
    await home.navigateToMarketplace();
    await home.clickFirstProduct();

    // Add to cart
    const baseURL = process.env.BASE_URL || 'https://sociva.lovable.app';
    await buyerPage.locator(
      'button:has-text("Add to Cart"), button:has-text("Add"), button:has-text("ADD")'
    ).first().click();
    await buyerPage.waitForTimeout(1_000);

    // Checkout with Razorpay
    const cart = new CartPage(buyerPage);
    await cart.goto();
    await cart.proceedToCheckout();

    const checkout = new CheckoutPage(buyerPage);
    await checkout.selectRazorpay();
    await checkout.placeOrder();

    // Wait for payment completion
    await buyerPage.waitForTimeout(3_000);

    // Get order ID
    const orderId = await checkout.getOrderId();

    // DB VALIDATION: order exists
    const order = await getOrder(db, orderId);
    expect(order).toBeTruthy();

    // DB VALIDATION: exactly 1 payment record
    const payments = await getPaymentRecord(db, orderId);
    expect(payments.length).toBe(1);
    expect(payments[0].status).toMatch(/captured|confirmed|success/i);
  });
});
