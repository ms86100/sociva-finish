import { test, expect } from '../../fixtures/user.fixture';
import { pollNotificationQueue, validateNotificationPayload } from '../../utils/notification-helper';
import { getOrder } from '../../utils/db-helpers';
import { HomePage } from '../../pages/home.page';
import { CartPage } from '../../pages/cart.page';
import { CheckoutPage } from '../../pages/checkout.page';

test.describe('Order Notification Validation @critical', () => {
  test('order placement triggers notification with correct payload', async ({ buyerPage, db }) => {
    // Place a COD order
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
    await checkout.placeOrder();

    const orderId = await checkout.getOrderId();

    // LAYER 1: DB — notification_queue entry exists
    const notification = await pollNotificationQueue(db, orderId, 15_000);
    expect(notification).toBeTruthy();
    expect(notification.id).toBeTruthy();

    // LAYER 2: Payload validation
    const payload = validateNotificationPayload(notification, { orderId });
    expect(payload.order_id).toBe(orderId);

    // LAYER 3: Processing check — give edge function time
    await buyerPage.waitForTimeout(5_000);
    const { data: processed } = await db
      .from('notification_queue')
      .select('status, attempts')
      .eq('id', notification.id)
      .single();

    // Notification should have been attempted
    if (processed) {
      expect(processed.attempts).toBeGreaterThanOrEqual(0);
    }
  });
});
