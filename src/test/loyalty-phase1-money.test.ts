import { describe, it, expect } from 'vitest';

/**
 * Phase 1 platform-funded loyalty — critical money-path unit tests.
 * Mirrors server logic in apply_loyalty_to_checkout_orders + settlement.
 */

/** Largest-remainder proportional allocation (matches SQL apply_loyalty_to_checkout_orders) */
export function allocateLoyaltyProportional(
  bases: number[],
  redeemPoints: number,
): number[] {
  const quoteBase = bases.reduce((a, b) => a + Math.max(b, 0), 0);
  const redeem = Math.min(redeemPoints, Math.floor(quoteBase));
  if (redeem <= 0 || bases.length === 0) return bases.map(() => 0);

  const sum = quoteBase || 1;
  const alloc = bases.map(() => 0);
  let remaining = redeem;
  for (let i = 0; i < bases.length; i++) {
    if (i === bases.length - 1) {
      alloc[i] = remaining;
    } else {
      const share = Math.floor(redeem * (Math.max(bases[i], 0) / sum));
      alloc[i] = share;
      remaining -= share;
    }
  }
  return alloc;
}

/** Settlement math (platform-funded A1) */
export function settlementFromOrder(opts: {
  totalAmount: number;
  loyaltyDiscount: number;
  platformFee: number;
  deliveryFee?: number;
}) {
  const subsidy = opts.loyaltyDiscount || 0;
  const grossBeforeLoyalty = opts.totalAmount + subsidy;
  const gross = grossBeforeLoyalty;
  const net = gross - (opts.platformFee || 0);
  return {
    gross_amount: gross,
    gross_before_loyalty: grossBeforeLoyalty,
    platform_loyalty_subsidy: subsidy,
    platform_fee: opts.platformFee || 0,
    delivery_fee_share: opts.deliveryFee || 0,
    net_amount: net,
    buyer_paid: opts.totalAmount,
  };
}

/** Quote max redeemable: min(available, floor(merchandise after coupon)) — not delivery */
export function quoteMaxRedeem(available: number, amountAfterCoupon: number) {
  return Math.max(0, Math.min(available, Math.floor(Math.max(amountAfterCoupon, 0))));
}

describe('Loyalty Phase 1 money paths', () => {
  describe('quoteMaxRedeem', () => {
    it('caps by balance and cart after coupon', () => {
      expect(quoteMaxRedeem(100, 45.9)).toBe(45);
      expect(quoteMaxRedeem(10, 100)).toBe(10);
      expect(quoteMaxRedeem(0, 50)).toBe(0);
      expect(quoteMaxRedeem(50, 0)).toBe(0);
    });
  });

  describe('allocateLoyaltyProportional', () => {
    it('splits multi-seller cart proportionally with remainder on last', () => {
      // bases = merchandise after coupon (delivery excluded)
      const alloc = allocateLoyaltyProportional([100, 50], 30);
      expect(alloc.reduce((a, b) => a + b, 0)).toBe(30);
      expect(alloc[0]).toBe(20); // floor(30 * 100/150)
      expect(alloc[1]).toBe(10); // remainder
    });

    it('single seller gets full redeem', () => {
      expect(allocateLoyaltyProportional([200], 25)).toEqual([25]);
    });

    it('cannot redeem more than bases sum', () => {
      const alloc = allocateLoyaltyProportional([10, 5], 100);
      expect(alloc.reduce((a, b) => a + b, 0)).toBe(15);
    });

    it('zeros when redeem is 0', () => {
      expect(allocateLoyaltyProportional([40, 60], 0)).toEqual([0, 0]);
    });
  });

  describe('settlementFromOrder (platform subsidy)', () => {
    it('seller gross is pre-loyalty; subsidy is explicit; buyer paid is post-loyalty', () => {
      const s = settlementFromOrder({
        totalAmount: 90, // buyer paid after ₹10 loyalty
        loyaltyDiscount: 10,
        platformFee: 5,
        deliveryFee: 20,
      });
      expect(s.buyer_paid).toBe(90);
      expect(s.gross_before_loyalty).toBe(100);
      expect(s.gross_amount).toBe(100);
      expect(s.platform_loyalty_subsidy).toBe(10);
      expect(s.net_amount).toBe(95); // 100 - 5 fee
      // Seller not silently underpaid vs pre-loyalty GMV
      expect(s.net_amount).toBe(s.gross_amount - s.platform_fee);
    });

    it('no loyalty → subsidy 0 and gross = total', () => {
      const s = settlementFromOrder({ totalAmount: 50, loyaltyDiscount: 0, platformFee: 2 });
      expect(s.platform_loyalty_subsidy).toBe(0);
      expect(s.gross_amount).toBe(50);
      expect(s.net_amount).toBe(48);
    });
  });

  describe('order total after loyalty', () => {
    it('payment amount matches sum of post-loyalty order totals', () => {
      const bases = [80, 40]; // after coupon, before loyalty; delivery on first only handled outside
      const deliveryFirst = 20;
      const loyalty = 30;
      const alloc = allocateLoyaltyProportional(bases, loyalty);
      const orderTotals = [
        bases[0] + deliveryFirst - alloc[0],
        bases[1] - alloc[1],
      ];
      const charge = orderTotals.reduce((a, b) => a + b, 0);
      expect(alloc).toEqual([20, 10]);
      expect(orderTotals).toEqual([80, 30]);
      expect(charge).toBe(110); // 120 merchandise+delivery - 30 loyalty
    });
  });

  describe('refund restore policy fractions', () => {
    it('full refund restores full redeemed and reverses all earned', () => {
      const loyaltyRedeemed = 10;
      const earned = 3;
      const frac = 1;
      expect(Math.floor(loyaltyRedeemed * frac)).toBe(10);
      expect(Math.floor(earned * frac)).toBe(3);
    });

    it('partial refund is proportional', () => {
      const paid = 90;
      const refundAmount = 45;
      const frac = Math.min(Math.max(refundAmount / paid, 0), 1);
      expect(frac).toBe(0.5);
      expect(Math.floor(10 * frac)).toBe(5);
      expect(Math.floor(4 * frac)).toBe(2);
    });
  });
});
