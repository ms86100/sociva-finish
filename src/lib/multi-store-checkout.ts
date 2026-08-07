/**
 * Multi-store checkout rules (Swiggy-aligned + P5 platform collect).
 *
 * Razorpay (platform collect) may cover N sellers in one payment → checkout_group.
 * Deep-link UPI remains single-VPA / single-seller only.
 * COD may keep multi-seller carts (N independent cash/order flows).
 */

export type CartPaymentMethod = 'cod' | 'upi' | 'online' | 'card' | string;

export type OnlineGateOptions = {
  /** Platform Razorpay Checkout.js collect — multi-seller allowed (P5). */
  isRazorpay?: boolean;
  /** Direct VPA deep-link — always single-seller. */
  isUpiDeepLink?: boolean;
};

/** True for any method that collects money online in one shot. */
export function isOnlinePaymentMethod(method: CartPaymentMethod): boolean {
  return method === 'upi' || method === 'online' || method === 'card';
}

/**
 * Online checkout with 2+ sellers is blocked only for non-platform (deep-link UPI).
 * Razorpay platform collect is unlocked (P5) once partial refunds (P4) ship.
 */
export function requiresSingleSellerForOnline(
  sellerCount: number,
  paymentMethod: CartPaymentMethod,
  opts?: OnlineGateOptions,
): boolean {
  if (sellerCount <= 1) return false;
  if (!isOnlinePaymentMethod(paymentMethod)) return false;
  if (opts?.isRazorpay) return false;
  // Deep-link or legacy UPI path: one VPA only
  return true;
}

/** Deep-link UPI is always single-VPA — never multi-seller. */
export function blocksUpiDeepLinkMultiSeller(
  sellerCount: number,
  isUpiDeepLink: boolean,
): boolean {
  return isUpiDeepLink && sellerCount > 1;
}

export function multiStoreBannerCopy(
  sellerCount: number,
  paymentMethod: CartPaymentMethod,
  opts?: OnlineGateOptions,
): {
  title: string;
  body: string;
} {
  if (sellerCount <= 1) {
    return { title: '', body: '' };
  }
  if (isOnlinePaymentMethod(paymentMethod) && opts?.isRazorpay) {
    return {
      title: `Items from ${sellerCount} stores`,
      body: 'One online payment covers all stores. Each seller accepts and fulfills their portion independently — if one store cancels, only that store’s amount is refunded.',
    };
  }
  if (isOnlinePaymentMethod(paymentMethod)) {
    return {
      title: `Items from ${sellerCount} stores`,
      body: 'UPI pays one seller’s VPA only. Checkout each store separately, or switch to Cash on Delivery to place all orders together.',
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
  if (sellerCount <= 1) return null;
  return `${sellerCount} separate orders will be created — one per store. One payment covers the full amount.`;
}
