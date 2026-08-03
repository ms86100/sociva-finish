/**
 * Multi-store checkout architecture guards (Phase 0/1).
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

  it('requires single seller for online when cart has 2+ stores', () => {
    expect(requiresSingleSellerForOnline(2, 'upi')).toBe(true);
    expect(requiresSingleSellerForOnline(2, 'cod')).toBe(false);
    expect(requiresSingleSellerForOnline(1, 'upi')).toBe(false);
  });

  it('blocks UPI deep-link for multi-seller', () => {
    expect(blocksUpiDeepLinkMultiSeller(2, true)).toBe(true);
    expect(blocksUpiDeepLinkMultiSeller(2, false)).toBe(false);
    expect(blocksUpiDeepLinkMultiSeller(1, true)).toBe(false);
  });

  it('uses online-specific banner copy for multi-store UPI', () => {
    const online = multiStoreBannerCopy(3, 'upi');
    expect(online.title).toMatch(/3 stores/);
    expect(online.body.toLowerCase()).toMatch(/one store/);

    const cod = multiStoreBannerCopy(3, 'cod');
    expect(cod.body.toLowerCase()).toMatch(/cash on delivery/);
  });

  it('explains blocked online multi-seller clearly', () => {
    expect(onlineMultiSellerBlockedMessage(true)).toMatch(/Checkout this store/i);
    expect(onlineMultiSellerBlockedMessage(false)).toMatch(/UPI/i);
  });

  it('hints separate orders for multi COD confirm', () => {
    expect(razorpayMultiStoreConfirmHint(1)).toBeNull();
    expect(razorpayMultiStoreConfirmHint(2)).toMatch(/2 separate orders/);
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

  it('blocks online multi-seller at place-order (Phase 1)', () => {
    expect(cartSrc).toMatch(/requiresSingleSellerForOnline\(sellerGroups\.length, paymentMethod\)/);
    expect(cartSrc).toMatch(/onlineMultiSellerBlockedMessage/);
    expect(cartSrc).toMatch(/checkoutThisStoreOnly/);
  });

  it('exposes Checkout this store on multi-seller cart UI', () => {
    expect(cartPageSrc).toMatch(/Checkout this store/);
    expect(cartPageSrc).toMatch(/checkoutThisStoreOnly/);
    expect(cartPageSrc).toMatch(/multiSellerOnlineBlocked=\{c\.isMultiSeller\}/);
  });

  it('never mounts UPI deep-link for multi pending orders', () => {
    expect(cartPageSrc).toMatch(/pendingOrderIds\.length === 1 && c\.paymentMode\.isUpiDeepLink/);
  });

  it('cancels multi-store online sessions on recovery instead of reopening broken pay UI', () => {
    expect(cartSrc).toMatch(/isMultiStoreOnlineSession/);
    expect(cartSrc).toMatch(/buyer_cancel_pending_orders/);
    expect(cartSrc).toMatch(/multi-store-session-cleared/);
  });

  it('disables full-cart place when multi-store has no COD path', () => {
    expect(cartSrc).toMatch(/multiStoreRequiresSplit/);
    expect(cartPageSrc).toMatch(/multiStoreRequiresSplit/);
  });

  it('rejects multi-seller Razorpay order create server-side', () => {
    expect(razorpayCreate).toMatch(/MULTI_SELLER_ONLINE_BLOCKED/);
    expect(razorpayCreate).toMatch(/uniqueSellers\.size > 1/);
  });

  it('writes per-order seller_id and platform_fee on Razorpay confirm (settlement audit)', () => {
    expect(razorpayConfirm).toMatch(/seller_id: orderData\.seller_id/);
    expect(razorpayConfirm).toMatch(/platform_fee: Number\(orderData\.platform_fee/);
    expect(razorpayConfirm).toMatch(/for \(const orderData of orders\)/);
  });
});
