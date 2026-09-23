/**
 * Shared coupon discount math and eligibility checks.
 * Used by cart checkout, service booking review, and unit tests.
 * Server RPCs re-validate; never trust client discount alone.
 */

export type CouponDiscountType = 'percentage' | 'flat' | 'fixed' | string;

export interface CouponDiscountInput {
  discount_type: CouponDiscountType;
  discount_value: number;
  max_discount_amount?: number | null;
  min_order_amount?: number | null;
}

export interface CouponEligibilityInput extends CouponDiscountInput {
  id?: string;
  seller_id?: string;
  is_active?: boolean;
  starts_at?: string | Date | null;
  expires_at?: string | Date | null;
  usage_limit?: number | null;
  times_used?: number;
  per_user_limit?: number;
}

export type CouponRejectReason =
  | 'inactive'
  | 'not_started'
  | 'expired'
  | 'usage_limit'
  | 'per_user_limit'
  | 'min_order'
  | 'wrong_seller'
  | 'missing';

export function calculateCouponDiscount(
  merchandiseTotal: number,
  coupon: CouponDiscountInput | null | undefined,
): number {
  if (!coupon || !Number.isFinite(merchandiseTotal) || merchandiseTotal <= 0) return 0;
  const value = Number(coupon.discount_value);
  if (!Number.isFinite(value) || value <= 0) return 0;

  let discount = 0;
  const type = String(coupon.discount_type || '').toLowerCase();
  if (type === 'percentage') {
    const clampedPct = Math.min(value, 100);
    discount = (merchandiseTotal * clampedPct) / 100;
    if (coupon.max_discount_amount != null && Number(coupon.max_discount_amount) > 0) {
      discount = Math.min(discount, Number(coupon.max_discount_amount));
    }
  } else {
    // flat / fixed / anything else treated as absolute amount
    discount = Math.min(value, merchandiseTotal);
  }

  return Math.round(Math.min(discount, merchandiseTotal) * 100) / 100;
}

export function evaluateCouponEligibility(
  coupon: CouponEligibilityInput | null | undefined,
  opts: {
    merchandiseTotal: number;
    sellerId?: string | null;
    userRedemptionCount?: number;
    now?: Date;
  },
): { ok: true; discount: number } | { ok: false; reason: CouponRejectReason } {
  if (!coupon) return { ok: false, reason: 'missing' };
  if (coupon.is_active === false) return { ok: false, reason: 'inactive' };

  const now = opts.now ?? new Date();
  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    return { ok: false, reason: 'not_started' };
  }
  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    return { ok: false, reason: 'expired' };
  }
  if (
    coupon.usage_limit != null &&
    coupon.times_used != null &&
    coupon.times_used >= coupon.usage_limit
  ) {
    return { ok: false, reason: 'usage_limit' };
  }
  const perUser = coupon.per_user_limit ?? 1;
  if ((opts.userRedemptionCount ?? 0) >= perUser) {
    return { ok: false, reason: 'per_user_limit' };
  }
  if (
    opts.sellerId &&
    coupon.seller_id &&
    coupon.seller_id !== opts.sellerId
  ) {
    return { ok: false, reason: 'wrong_seller' };
  }
  if (
    coupon.min_order_amount != null &&
    Number(coupon.min_order_amount) > 0 &&
    opts.merchandiseTotal < Number(coupon.min_order_amount)
  ) {
    return { ok: false, reason: 'min_order' };
  }

  return {
    ok: true,
    discount: calculateCouponDiscount(opts.merchandiseTotal, coupon),
  };
}

export function amountAfterCoupon(merchandiseTotal: number, discount: number): number {
  return Math.max(0, Math.round((merchandiseTotal - Math.max(0, discount)) * 100) / 100);
}
