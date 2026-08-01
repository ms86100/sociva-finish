// @ts-nocheck
import { toast } from 'sonner';
import { hapticImpact, hapticNotification, hapticSelection } from '@/lib/haptics';

/**
 * Global Feedback Engine
 *
 * Every user-facing action routes through a typed function here.
 * Contract: haptic → toast → CustomEvent (where applicable).
 *
 * Rules:
 *   • No component should call toast.success/error directly for
 *     cart or order actions — use these functions instead.
 *   • Failure variants exist so the UI never "lies" after rollback.
 */

// ── Helpers ─────────────────────────────────────────────────────────

function truncate(name: string, max = 28): string {
  return name.length > max ? name.slice(0, max) + '…' : name;
}

function dispatch(event: string) {
  window.dispatchEvent(new CustomEvent(event));
}

// ── Cart Feedback ───────────────────────────────────────────────────

export function feedbackAddItem(productName: string) {
  hapticImpact('medium');
  toast.success(`${truncate(productName)} added`, { id: 'cart-add', duration: 1500 });
  dispatch('cart-item-added');
}

export function feedbackAddItemFailed(productName: string) {
  toast.error(`${truncate(productName)} couldn't be added — please try again`, {
    id: 'cart-add-fail',
    duration: 2500,
  });
}

export function feedbackRemoveItem(productName: string, undoFn?: () => void) {
  hapticImpact('light');
  toast(`${truncate(productName)} removed`, {
    id: 'cart-remove',
    duration: 4000,
    ...(undoFn ? { action: { label: 'Undo', onClick: undoFn } } : {}),
  });
  dispatch('cart-item-removed');
}

export function feedbackRemoveItemFailed() {
  toast.error("Couldn't remove item — please try again", {
    id: 'cart-remove-fail',
    duration: 2500,
  });
}

export function feedbackQuantityChanged() {
  hapticImpact('light');
  dispatch('cart-item-updated');
}

export function feedbackQuantityFailed() {
  toast.error("Couldn't update quantity — please try again", {
    id: 'cart-qty-fail',
    duration: 2500,
  });
}

// ── Order Feedback ──────────────────────────────────────────────────

export function feedbackOrderPlaced() {
  hapticNotification('success');
  toast.success('Order placed!', { id: 'order-placed', duration: 2500 });
  dispatch('order-placed');
}

export function feedbackOrderFailed(message?: string) {
  hapticNotification('error');
  toast.error(message || 'Order failed — please try again', {
    id: 'order-failed',
    duration: 3500,
  });
}

// ── Payment Feedback ────────────────────────────────────────────────

export function feedbackPaymentResult(success: boolean, message?: string) {
  if (success) {
    hapticNotification('success');
    toast.success(message || 'Payment confirmed', { id: 'payment-result', duration: 2500 });
    dispatch('payment-success');
  } else {
    hapticNotification('error');
    toast.error(message || 'Payment failed — try again', { id: 'payment-result', duration: 3500 });
    dispatch('payment-failed');
  }
}

// ── Coupon Feedback ─────────────────────────────────────────────────

export function feedbackCouponApplied(savings: string) {
  hapticImpact('medium');
  toast.success(`Coupon applied! You save ${savings}`, {
    id: 'coupon-applied',
    duration: 2200,
  });
  dispatch('coupon-applied');
}

export function feedbackCouponFailed(reason: string) {
  toast.error(reason, {
    id: 'coupon-failed',
    duration: 2500,
  });
}

// ── Cart Cleared Feedback ───────────────────────────────────────────

export function feedbackCartCleared() {
  hapticImpact('light');
  toast('Cart cleared', { id: 'cart-cleared', duration: 1800 });
  dispatch('cart-cleared');
}

// ── Favorite Feedback ───────────────────────────────────────────────

export function feedbackFavoriteToggled(added: boolean, productName: string) {
  hapticImpact('light');
  toast(added ? `${truncate(productName)} saved` : `${truncate(productName)} removed from saved`, {
    id: 'favorite-toggle',
    duration: 1800,
  });
  dispatch('favorite-toggled');
}

// ── Delivery Status Feedback ────────────────────────────────────────

export function feedbackStatusChange(status: string) {
  hapticSelection();
  dispatch('order-status-changed');
}
