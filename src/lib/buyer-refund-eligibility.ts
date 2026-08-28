/** Hours after successful delivery that a buyer may request a refund. */
export const BUYER_REFUND_WINDOW_HOURS = 2;

const DELIVERED_STATUSES = new Set(['delivered', 'completed', 'buyer_received']);
const PAID_STATUSES = new Set(['paid', 'buyer_confirmed', 'seller_verified', 'completed']);

export type BuyerRefundEligibilityReason =
  | 'ok'
  | 'not_delivered'
  | 'no_payment'
  | 'window_closed'
  | 'missing_delivery_timestamp';

export interface BuyerRefundEligibility {
  eligible: boolean;
  reason: BuyerRefundEligibilityReason;
  expiresAt: string | null;
  windowHours: number;
}

function deliveryAnchor(opts: {
  deliveredAt?: string | null;
  completedAt?: string | null;
  statusChangedAt?: string | null;
}): Date | null {
  const raw = opts.deliveredAt || opts.completedAt || opts.statusChangedAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getBuyerRefundEligibility(opts: {
  orderStatus: string;
  paymentStatus: string;
  deliveredAt?: string | null;
  completedAt?: string | null;
  statusChangedAt?: string | null;
  now?: Date;
}): BuyerRefundEligibility {
  const now = opts.now ?? new Date();
  const windowMs = BUYER_REFUND_WINDOW_HOURS * 60 * 60 * 1000;

  if (!PAID_STATUSES.has(opts.paymentStatus)) {
    return {
      eligible: false,
      reason: 'no_payment',
      expiresAt: null,
      windowHours: BUYER_REFUND_WINDOW_HOURS,
    };
  }

  if (!DELIVERED_STATUSES.has(opts.orderStatus)) {
    return {
      eligible: false,
      reason: 'not_delivered',
      expiresAt: null,
      windowHours: BUYER_REFUND_WINDOW_HOURS,
    };
  }

  const anchor = deliveryAnchor(opts);
  if (!anchor) {
    return {
      eligible: false,
      reason: 'missing_delivery_timestamp',
      expiresAt: null,
      windowHours: BUYER_REFUND_WINDOW_HOURS,
    };
  }

  const expiresAt = new Date(anchor.getTime() + windowMs);
  if (now.getTime() > expiresAt.getTime()) {
    return {
      eligible: false,
      reason: 'window_closed',
      expiresAt: expiresAt.toISOString(),
      windowHours: BUYER_REFUND_WINDOW_HOURS,
    };
  }

  return {
    eligible: true,
    reason: 'ok',
    expiresAt: expiresAt.toISOString(),
    windowHours: BUYER_REFUND_WINDOW_HOURS,
  };
}

export function buyerRefundWindowClosedMessage(windowHours = BUYER_REFUND_WINDOW_HOURS): string {
  return `Refund requests must be submitted within ${windowHours} hour${windowHours === 1 ? '' : 's'} of delivery. That window has closed.`;
}
