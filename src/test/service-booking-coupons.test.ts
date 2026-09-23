import { describe, expect, it } from 'vitest';
import {
  amountAfterCoupon,
  calculateCouponDiscount,
  evaluateCouponEligibility,
} from '@/lib/coupon';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('service booking coupon helpers', () => {
  it('calculates percentage discount with max cap', () => {
    expect(
      calculateCouponDiscount(1000, {
        discount_type: 'percentage',
        discount_value: 20,
        max_discount_amount: 150,
      }),
    ).toBe(150);
  });

  it('calculates flat discount without exceeding merchandise', () => {
    expect(
      calculateCouponDiscount(80, {
        discount_type: 'flat',
        discount_value: 100,
      }),
    ).toBe(80);
  });

  it('rejects expired, wrong seller, min order, and per-user limit', () => {
    const base = {
      id: 'c1',
      seller_id: 'seller-a',
      is_active: true,
      discount_type: 'percentage',
      discount_value: 10,
      starts_at: '2020-01-01T00:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
      usage_limit: 100,
      times_used: 1,
      per_user_limit: 1,
      min_order_amount: 200,
    };

    expect(
      evaluateCouponEligibility(
        { ...base, expires_at: '2020-01-02T00:00:00Z' },
        { merchandiseTotal: 500, sellerId: 'seller-a' },
      ).ok,
    ).toBe(false);

    expect(
      evaluateCouponEligibility(base, {
        merchandiseTotal: 500,
        sellerId: 'seller-b',
      }),
    ).toMatchObject({ ok: false, reason: 'wrong_seller' });

    expect(
      evaluateCouponEligibility(base, {
        merchandiseTotal: 100,
        sellerId: 'seller-a',
      }),
    ).toMatchObject({ ok: false, reason: 'min_order' });

    expect(
      evaluateCouponEligibility(base, {
        merchandiseTotal: 500,
        sellerId: 'seller-a',
        userRedemptionCount: 1,
      }),
    ).toMatchObject({ ok: false, reason: 'per_user_limit' });

    const ok = evaluateCouponEligibility(base, {
      merchandiseTotal: 500,
      sellerId: 'seller-a',
      userRedemptionCount: 0,
    });
    expect(ok).toMatchObject({ ok: true, discount: 50 });
  });

  it('amountAfterCoupon never goes negative', () => {
    expect(amountAfterCoupon(100, 150)).toBe(0);
    expect(amountAfterCoupon(500, 50)).toBe(450);
  });
});

describe('service booking coupon wiring (contract)', () => {
  it('ServiceBookingFlow mounts CouponInput and passes _coupon_id', () => {
    const flow = read('src/components/booking/ServiceBookingFlow.tsx');
    expect(flow).toContain("from '@/components/cart/CouponInput'");
    expect(flow).toContain('booking-coupon-section');
    expect(flow).toContain('_coupon_id: appliedCoupon?.id || null');
    expect(flow).toContain('calculateCouponDiscount');
  });

  it('migration extends create_service_booking_atomic with server coupon validation', () => {
    const mig = read('supabase/migrations/20260923210000_service_booking_coupons.sql');
    expect(mig).toContain('_coupon_id text DEFAULT NULL');
    expect(mig).toContain('Invalid or ineligible coupon');
    expect(mig).toContain('coupon_redemptions');
    expect(mig).toContain('coupon_id, coupon_discount, discount_amount');
    expect(mig).toContain('times_used = times_used + 1');
  });

  it('CouponManager remains seller-scoped (available to service sellers via Tools tab)', () => {
    const dash = read('src/pages/SellerDashboardPage.tsx');
    expect(dash).toContain('CouponManager');
    expect(dash).toContain('coupon-section');
    const mgr = read('src/components/seller/CouponManager.tsx');
    expect(mgr).toContain(".from('coupons')");
    expect(mgr).toContain('seller_id');
  });
});
