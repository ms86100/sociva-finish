/**
 * Multi-store checkout architecture guards (P5: Razorpay multi unlocked).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isOnlinePaymentMethod,
  requiresSingleSellerForOnline,
  blocksUpiDeepLinkMultiSeller,
  multiStoreBannerCopy,
  onlineMultiSellerBlockedMessage,
  razorpayMultiStoreConfirmHint,
} from '@/lib/multi-store-checkout';

describe('multi-store checkout rules', () => {
  it('treats upi/online/card as online payment methods', () => {
    expect(isOnlinePaymentMethod('upi')).toBe(true);
    expect(isOnlinePaymentMethod('online')).toBe(true);
    expect(isOnlinePaymentMethod('card')).toBe(true);
    expect(isOnlinePaymentMethod('cod')).toBe(false);
  });

  it('allows Razorpay multi-seller online (P5) but blocks deep-link UPI multi', () => {
    expect(requiresSingleSellerForOnline(2, 'upi', { isRazorpay: true })).toBe(false);
    expect(requiresSingleSellerForOnline(2, 'upi', { isRazorpay: false })).toBe(true);
    expect(requiresSingleSellerForOnline(2, 'cod')).toBe(false);
    expect(requiresSingleSellerForOnline(1, 'upi')).toBe(false);
  });

  it('blocks UPI deep-link for multi-seller', () => {
    expect(blocksUpiDeepLinkMultiSeller(2, true)).toBe(true);
    expect(blocksUpiDeepLinkMultiSeller(2, false)).toBe(false);
    expect(blocksUpiDeepLinkMultiSeller(1, true)).toBe(false);
  });

  it('uses Razorpay multi banner when platform collect', () => {
    const online = multiStoreBannerCopy(3, 'upi', { isRazorpay: true });
    expect(online.title).toMatch(/3 stores/);
    expect(online.body.toLowerCase()).toMatch(/one online payment|refunded/);

    const deepLink = multiStoreBannerCopy(3, 'upi', { isRazorpay: false });
    expect(deepLink.body.toLowerCase()).toMatch(/upi|vpa|one seller/);

    const cod = multiStoreBannerCopy(3, 'cod');
    expect(cod.body.toLowerCase()).toMatch(/cash on delivery/);
  });

  it('explains blocked online multi-seller clearly', () => {
    expect(onlineMultiSellerBlockedMessage(true)).toMatch(/Checkout this store/i);
    expect(onlineMultiSellerBlockedMessage(false)).toMatch(/UPI/i);
  });

  it('hints separate orders for multi Razorpay confirm', () => {
    expect(razorpayMultiStoreConfirmHint(1)).toBeNull();
    expect(razorpayMultiStoreConfirmHint(2)).toMatch(/2 separate orders/);
    expect(razorpayMultiStoreConfirmHint(2)).toMatch(/One payment/i);
  });
});

describe('multi-store source contracts', () => {
  const cartSrc = readFileSync(resolve(__dirname, '../hooks/useCartPage.ts'), 'utf8');
  const cartPageSrc = readFileSync(resolve(__dirname, '../pages/CartPage.tsx'), 'utf8');
  const razorpayCreate = readFileSync(
    resolve(__dirname, '../../supabase/functions/create-razorpay-order/index.ts'),
    'utf8',
  );
  const razorpayConfirm = readFileSync(
    resolve(__dirname, '../../supabase/functions/confirm-razorpay-payment/index.ts'),
    'utf8',
  );
  const atomicConfirmMigration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20260808020000_phase0_atomic_confirm_inventory_secrets.sql'),
    'utf8',
  );
  const paymentTruthMigration = readFileSync(
    resolve(__dirname, '../../supabase/migrations/20260808131000_attempt_aware_payment_truth.sql'),
    'utf8',
  );
  const refundProcessor = readFileSync(
    resolve(__dirname, '../../supabase/functions/refund-processor/index.ts'),
    'utf8',
  );

  it('gates online multi with Razorpay opts (P5 unlock)', () => {
    expect(cartSrc).toMatch(/requiresSingleSellerForOnline\(sellerGroups\.length, paymentMethod/);
    expect(cartSrc).toMatch(/isRazorpay:\s*paymentMode\.isRazorpay/);
    expect(cartSrc).toMatch(/checkoutThisStoreOnly/);
  });

  it('exposes Checkout this store on multi-seller cart UI', () => {
    expect(cartPageSrc).toMatch(/Checkout this store/);
    expect(cartPageSrc).toMatch(/checkoutThisStoreOnly/);
    expect(cartPageSrc).toMatch(/multiSellerOnlineBlocked=\{c\.onlineBlockedForMultiCart/);
  });

  it('never mounts UPI deep-link for multi pending orders', () => {
    expect(cartPageSrc).toMatch(/pendingOrderIds\.length === 1 && c\.paymentMode\.isUpiDeepLink/);
  });

  it('clears only non-Razorpay multi-store sessions on recovery', () => {
    expect(cartSrc).toMatch(/isMultiStoreOnlineSession/);
    expect(cartSrc).toMatch(/session\.paymentMethod !== 'razorpay'/);
    expect(cartSrc).toMatch(/buyer_cancel_pending_orders/);
    expect(cartSrc).toMatch(/multi-store-session-cleared/);
  });

  it('disables full-cart place when multi-store requires split', () => {
    expect(cartSrc).toMatch(/multiStoreRequiresSplit/);
    expect(cartPageSrc).toMatch(/multiStoreRequiresSplit/);
  });

  it('allows multi-seller Razorpay create (no MULTI_SELLER_ONLINE_BLOCKED)', () => {
    expect(razorpayCreate).not.toMatch(/MULTI_SELLER_ONLINE_BLOCKED/);
    expect(razorpayCreate).toMatch(/isMultiSeller/);
    expect(razorpayCreate).toMatch(/platform_collect/);
    expect(razorpayCreate).toMatch(/checkout_group_id/);
  });

  it('atomically writes per-order payment rows and stamps group capture', () => {
    expect(razorpayConfirm).toMatch(/confirm_captured_payment_group/);
    expect(razorpayConfirm).toMatch(/p_order_ids: order_ids/);
    expect(paymentTruthMigration).toMatch(/confirm_orders_after_razorpay_payment/);
    expect(paymentTruthMigration).toMatch(/payment_capture_allocations/);
    expect(atomicConfirmMigration).toMatch(/INSERT INTO public\.payment_records/);
    expect(atomicConfirmMigration).toMatch(/seller_id[\s\S]*v_order\.seller_id/);
    expect(atomicConfirmMigration).toMatch(/platform_fee[\s\S]*v_order\.platform_fee/);
    expect(atomicConfirmMigration).toMatch(/PERFORM public\.stamp_checkout_group_capture/);
  });

  it('refund-processor resolves partial group gateway context', () => {
    expect(refundProcessor).toMatch(/resolve_refund_gateway_context/);
    expect(refundProcessor).toMatch(/amount_refunded/);
    expect(refundProcessor).toMatch(/reverse_all|reverseAll/);
  });
});
