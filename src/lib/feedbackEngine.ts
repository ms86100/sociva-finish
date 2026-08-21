// @ts-nocheck
import { toast } from 'sonner';
import { hapticImpact, hapticNotification, hapticSelection } from '@/lib/haptics';
import { showFeedback } from '@/components/FeedbackPopupProvider';

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
  showFeedback({
    title: 'Added to cart',
    description: `${truncate(productName)} is in your cart.`,
    variant: 'success',
  });
  dispatch('cart-item-added');
}

export function feedbackAddItemFailed(productName: string) {
  hapticNotification('error');
  toast.error(`${truncate(productName)} couldn't be added — please try again`, {
    id: 'cart-add-fail',
    duration: 2500,
  });
}

export function feedbackRemoveItem(productName: string, undoFn?: () => void) {
  hapticImpact('light');
  showFeedback({
    title: 'Removed from cart',
    description: `${truncate(productName)} is no longer in your cart.`,
    variant: 'success',
    actionLabel: undoFn ? 'Undo' : undefined,
    onAction: undoFn,
  });
  dispatch('cart-item-removed');
}

export function feedbackRemoveItemFailed() {
  hapticNotification('error');
  toast.error("Couldn't remove item — please try again", {
    id: 'cart-remove-fail',
    duration: 2500,
  });
}

export function feedbackQuantityChanged() {
  hapticImpact('light');
  showFeedback({
    title: 'Quantity updated',
    variant: 'success',
  });
  dispatch('cart-item-updated');
}

export function feedbackQuantityFailed() {
  hapticNotification('error');
  toast.error("Couldn't update quantity — please try again", {
    id: 'cart-qty-fail',
    duration: 2500,
  });
}

// ── Order Feedback ──────────────────────────────────────────────────

export function feedbackOrderPlaced() {
  hapticNotification('success');
  showFeedback({
    title: 'Order placed',
    description: 'You can track it from Orders.',
    variant: 'success',
  });
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
    showFeedback({
      title: 'Payment successful',
      description: 'Your payment has been received.',
      variant: 'success',
    });
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
  showFeedback({
    title: 'Coupon applied',
    description: `Saved ${savings}`,
    variant: 'success',
  });
  dispatch('coupon-applied');
}

export function feedbackCouponFailed(reason: string) {
  hapticNotification('warning');
}

// ── Cart Cleared Feedback ───────────────────────────────────────────

export function feedbackCartCleared() {
  hapticImpact('light');
  showFeedback({
    title: 'Cart cleared',
    description: 'Your cart is empty.',
    variant: 'success',
  });
  dispatch('cart-cleared');
}

// ── Favorite Feedback ───────────────────────────────────────────────

export function feedbackFavoriteToggled(added: boolean, productName: string) {
  hapticImpact('light');
  showFeedback({
    title: added ? 'Saved' : 'Removed from saved',
    description: truncate(productName),
    variant: 'success',
  });
  dispatch('favorite-toggled');
}

// ── Delivery Status Feedback ────────────────────────────────────────

export function feedbackStatusChange(status: string) {
  hapticSelection();
  dispatch('order-status-changed');
}
