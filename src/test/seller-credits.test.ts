import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickNotificationRoute } from '@/lib/notification-routes';
import {
  creditActivityDetails,
  creditEventForOrder,
  creditHealth,
  creditsReconcile,
  CUSTOMER_UNAVAILABLE_ORDERS,
  CUSTOMER_UNAVAILABLE_REQUESTS,
  isSellerCreditInsufficientError,
  SELLER_CREDITS_EXHAUSTED,
  SELLER_CREDITS_ROUTE,
  SELLER_EARNINGS_WALLET_ROUTE,
  sellerCreditCustomerMessage,
  shouldChargeOrderCompleted,
} from '@/lib/sellerCredits';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Sociva Credits', () => {
  it('keeps credits and earnings on separate routes', () => {
    expect(SELLER_CREDITS_ROUTE).toBe('/seller/credits');
    expect(SELLER_EARNINGS_WALLET_ROUTE).toBe('/seller/wallet');
    expect(pickNotificationRoute({ type: 'settlement' })).toBe('/seller/wallet');
    expect(pickNotificationRoute({ type: 'seller_credit_purchased' })).toBe('/seller/credits');
    expect(pickNotificationRoute({ type: 'seller_credit_exhausted' })).toBe('/seller/credits');
    expect(pickNotificationRoute({ type: 'seller_credit_low' })).toBe('/seller/credits');
    expect(pickNotificationRoute({ type: 'seller_approved' })).toBe('/seller/credits');
  });

  it('does not double-bill enquiry or booking as ORDER_COMPLETED', () => {
    expect(creditEventForOrder('enquiry', 'request_service')).toBe('ENQUIRY_CREATED');
    expect(creditEventForOrder('enquiry', 'contact_enquiry')).toBe('ENQUIRY_CREATED');
    expect(shouldChargeOrderCompleted('enquiry', 'request_service')).toBe(false);
    expect(creditEventForOrder('booking', 'service_booking')).toBe('SERVICE_BOOKING');
    expect(shouldChargeOrderCompleted('booking', 'service_booking')).toBe(false);
    expect(creditEventForOrder('cart', 'seller_delivery')).toBe('ORDER_COMPLETED');
    expect(shouldChargeOrderCompleted('cart', 'seller_delivery')).toBe(true);
  });

  it('uses action-specific customer copy and seller exhausted copy', () => {
    expect(CUSTOMER_UNAVAILABLE_ORDERS).toBe('This seller is currently unavailable for new orders.');
    expect(CUSTOMER_UNAVAILABLE_REQUESTS).toBe('This seller is currently unavailable for new requests.');
    expect(SELLER_CREDITS_EXHAUSTED).toBe(
      'Your Sociva Credits are exhausted. Recharge to start accepting new orders again.',
    );
    expect(isSellerCreditInsufficientError('SELLER_CREDIT_INSUFFICIENT: blocked')).toBe(true);
    expect(sellerCreditCustomerMessage('SELLER_CREDIT_INSUFFICIENT: x', 'ORDER_COMPLETED')).toBe(CUSTOMER_UNAVAILABLE_ORDERS);
    expect(sellerCreditCustomerMessage('SELLER_CREDIT_INSUFFICIENT: x', 'ENQUIRY_CREATED')).toBe(CUSTOMER_UNAVAILABLE_REQUESTS);
    expect(sellerCreditCustomerMessage('SELLER_CREDIT_INSUFFICIENT: x', 'SERVICE_BOOKING')).toBe(CUSTOMER_UNAVAILABLE_REQUESTS);
    expect(creditHealth(0)).toBe('exhausted');
    expect(creditHealth(25, { healthyMin: 100, lowMin: 50 })).toBe('critical');
    expect(creditHealth(1, { healthyMin: 100, lowMin: 50, criticalMin: 1 })).toBe('critical');
    expect(creditHealth(75, { healthyMin: 100, lowMin: 50 })).toBe('low');
    expect(creditHealth(120, { healthyMin: 100, lowMin: 50 })).toBe('healthy');
    expect(creditHealth(25)).toBe('healthy');
  });

  it('explains activity without hard-coded prices', () => {
    expect(creditActivityDetails({
      event_type: 'SERVICE_BOOKING',
      reference_short: 'A1B2C3D4',
      product_name: 'Guitar lesson',
      booking_date: '2026-08-22',
      start_time: '17:00:00',
      description: 'Reserved for Booking #A1B2C3D4',
    })).toEqual(expect.arrayContaining([
      'Booking #A1B2C3D4',
      'Product: Guitar lesson',
      'Appointment: 2026-08-22, 17:00',
    ]));
  });

  it('reconciles purchased minus consumed minus reserved', () => {
    expect(creditsReconcile({
      lifetimePurchased: 1000,
      lifetimeAdjusted: 0,
      lifetimeConsumed: 300,
      reserved: 15,
    })).toBe(685);
  });

  it('uses admin-configured booking resolution and does not hard-code rates in new billing SQL', () => {
    const sql = read('supabase/migrations/20260822060848_seller_credits_value_based_billing.sql');
    const fix = read('supabase/migrations/20260822062412_seller_credits_remediation_100.sql');
    const wallet = read('src/pages/SellerWalletPage.tsx');
    const credits = read('src/pages/SellerCreditsPage.tsx');
    const card = read('src/components/seller/SocivaCreditsCard.tsx');
    const admin = read('src/pages/AdminSellerCreditsPage.tsx');
    expect(sql).toMatch(/resolve_due_seller_credit_bookings/);
    expect(sql).toMatch(/booking_resolution_grace_minutes/);
    expect(sql).toMatch(/buyer_no_show_policy/);
    expect(sql).toMatch(/seller_credit_on_service_booking/);
    expect(sql).toMatch(/configured_price/);
    expect(sql).not.toMatch(/VALUES\s*\(\s*'ORDER_COMPLETED',\s*true,\s*10/);
    expect(sql).not.toMatch(/make_interval\(mins => 30\)/);
    expect(sql).not.toMatch(/finance\.post_journal/);
    expect(fix).toMatch(/seller_credit_contact_debits/);
    expect(fix).toMatch(/credit_blocked_sellers/);
    expect(fix).toMatch(/reverse_seller_credit_charge/);
    expect(fix).toMatch(/Set booking grace minutes and buyer no-show policy before enabling Spend/);
    expect(fix).toMatch(/jsonb_build_object\('ok', true, 'gated', false\)/);
    expect(fix).toMatch(/seller_credit_can_accept/);
    expect(fix).not.toMatch(/RETURN jsonb_build_object\(\s*'ok', v_acct.available >= v_rule.amount/);
    expect(sql).toMatch(/This seller is currently unavailable for new orders/);
    expect(sql).toMatch(/This seller is currently unavailable for new requests/);
    expect(wallet).not.toMatch(/Sociva Credits/);
    expect(credits).toMatch(/Sociva Credits/);
    expect(credits).toMatch(/not customer earnings/);
    expect(credits).toMatch(/Total available for new activity/);
    expect(card).toMatch(/SELLER_CREDITS_EXHAUSTED/);
    expect(admin).toMatch(/Monetization/);
    expect(admin).toMatch(/future events only/);
    expect(admin).toMatch(/Credit packages/);
    expect(admin).toMatch(/Credit purchases/);
    expect(admin).toMatch(/Health thresholds/);
    expect(admin).not.toMatch(/graceMinutes.*=.*['"]30['"]/);
    expect(admin).not.toMatch(/booking_resolution_grace_minutes['"]\s*,\s*['"]30['"]/);
    expect(read('src/App.tsx')).toMatch('/seller/credits');
    expect(read('supabase/functions/razorpay-webhook/index.ts')).toMatch('seller_credit_purchase');
    expect(read('src/components/product/ProductEnquirySheet.tsx')).toMatch('create_enquiry_atomic');
    expect(read('src/components/product/ContactSellerModal.tsx')).toMatch('log_seller_contact_interaction');
    expect(read('src/hooks/useCartPage.ts')).toMatch('credit_blocked_sellers');
    const privileged = read('supabase/migrations/20260822081000_seller_credits_privileged_actor_jwt.sql');
    expect(privileged).toMatch(/IF auth\.uid\(\) IS NOT NULL THEN/);
    expect(privileged).toMatch(/RETURN public\.is_admin\(auth\.uid\(\)\)/);
    expect(privileged).toMatch(/v_jwt_role IN \('anon', 'authenticated'\)/);
    expect(privileged).not.toMatch(/RETURN current_user IN \('postgres'/);
  });
});
