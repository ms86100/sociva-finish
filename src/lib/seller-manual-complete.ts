export const SELLER_MANUAL_COMPLETE_RPC = 'seller_complete_order_without_otp';

export const SELLER_MANUAL_COMPLETE_COPY = {
  title: 'Confirm order completion',
  body: 'Are you sure this order has been successfully delivered or handed over to the customer? This will complete the order without OTP verification.',
  cancel: 'Cancel',
  confirm: 'Confirm Delivery',
  deliveryButton: 'Mark Delivered Without OTP',
  pickupButton: 'Mark Completed Without OTP',
} as const;

export function sellerManualCompleteButtonLabel(otpType: string | null | undefined): string {
  if (otpType === 'generic') return SELLER_MANUAL_COMPLETE_COPY.pickupButton;
  return SELLER_MANUAL_COMPLETE_COPY.deliveryButton;
}

/** Shown only when the seller already has an OTP completion CTA. */
export function isSellerManualCompleteEligible(
  otpType: string | null | undefined,
  hasDeliveryAssignment: boolean,
): boolean {
  if (otpType === 'generic') return true;
  if ((otpType === 'delivery' || otpType === 'delivery_otp') && hasDeliveryAssignment) return true;
  return false;
}

export type SellerManualCompleteErrorKind =
  | 'session'
  | 'unauthorized'
  | 'already_complete'
  | 'cancelled'
  | 'refunded'
  | 'scheduled'
  | 'invalid_state'
  | 'network'
  | 'generic';

export function mapSellerManualCompleteError(message: string | null | undefined): {
  kind: SellerManualCompleteErrorKind;
  text: string;
} {
  const raw = (message || '').trim();
  const lower = raw.toLowerCase();

  if (
    lower.includes('jwt expired')
    || lower.includes('invalid jwt')
    || lower.includes('not authenticated')
    || lower.includes('authentication required')
  ) {
    return { kind: 'session', text: 'Your session expired. Please sign in again.' };
  }

  if (lower.includes('failed to fetch') || lower.includes('network') || lower.includes('timeout')) {
    return { kind: 'network', text: 'Network error. The order was not marked complete. Try again.' };
  }
  if (lower.includes('not authorized')) {
    return { kind: 'unauthorized', text: 'You are not authorized to complete this order.' };
  }
  if (lower.includes('already') && lower.includes('complet')) {
    return { kind: 'already_complete', text: 'This order is already completed.' };
  }
  if (lower.includes('refund')) {
    return { kind: 'refunded', text: 'A refunded order cannot be completed.' };
  }
  if (lower.includes('cancelled') || lower.includes('closed order')) {
    return { kind: 'cancelled', text: 'This order cannot be completed because it is cancelled or closed.' };
  }
  if (lower.includes('scheduled fulfillment') || lower.includes('preparation window')) {
    return { kind: 'scheduled', text: 'This scheduled order is not open for fulfillment yet.' };
  }
  if (lower.includes('not eligible') || lower.includes('invalid') || lower.includes('cannot find current step')) {
    return { kind: 'invalid_state', text: 'This order is not in a state that can be completed yet.' };
  }

  return { kind: 'generic', text: raw || 'Could not complete this order. Try again.' };
}

export function shouldShowManualCompleteSuccess(
  rpcSucceeded: boolean,
  alreadyComplete: boolean,
): boolean {
  return rpcSucceeded && !alreadyComplete;
}
