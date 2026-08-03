/**
 * Multi-store checkout rules (Swiggy-aligned).
 *
 * Online pay (UPI deep-link or Razorpay) = one seller per checkout.
 * COD may keep multi-seller carts (N independent cash/order flows).
 * Never deep-link UPI across multiple VPAs in one payment.
 */

export type CartPaymentMethod = 'cod' | 'upi' | 'online' | 'card' | string;

/** True for any method that collects money online in one shot. */
export function isOnlinePaymentMethod(method: CartPaymentMethod): boolean {
  return method === 'upi' || method === 'online' || method === 'card';
}

/** Online checkout with 2+ sellers is not allowed (Phase 1). */
export function requiresSingleSellerForOnline(
  sellerCount: number,
  paymentMethod: CartPaymentMethod,
): boolean {
  return sellerCount > 1 && isOnlinePaymentMethod(paymentMethod);
}

/** Deep-link UPI is always single-VPA — never multi-seller. */
export function blocksUpiDeepLinkMultiSeller(
  sellerCount: number,
  isUpiDeepLink: boolean,
): boolean {
  return isUpiDeepLink && sellerCount > 1;
}

export function multiStoreBannerCopy(sellerCount: number, paymentMethod: CartPaymentMethod): {
  title: string;
  body: string;
} {
  if (sellerCount <= 1) {
    return { title: '', body: '' };
  }
  if (isOnlinePaymentMethod(paymentMethod)) {
    return {
      title: `Items from ${sellerCount} stores`,
      body: 'Online payment works for one store at a time (same as Swiggy). Checkout each store separately, or switch to Cash on Delivery to place all orders together.',
    };
  }
  return {
    title: `Items from ${sellerCount} stores`,
    body: 'Cash on Delivery will create a separate order for each store. Each seller accepts and fulfills independently.',
  };
}

export function onlineMultiSellerBlockedMessage(isRazorpay: boolean): string {
  return isRazorpay
    ? 'Pay online for one store at a time. Tap “Checkout this store” on a seller, or use Cash on Delivery for all stores.'
    : 'UPI pays one seller’s VPA only. Tap “Checkout this store” on a seller, or use Cash on Delivery for all stores.';
}

export function razorpayMultiStoreConfirmHint(sellerCount: number): string | null {
  // After Phase 1, online multi is blocked — hint kept for COD / future platform-collect.
  if (sellerCount <= 1) return null;
  return `${sellerCount} separate orders will be created — one per store.`;
}
