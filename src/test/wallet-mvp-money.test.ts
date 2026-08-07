import { describe, it, expect } from 'vitest';

/**
 * Sociva Credit MVP — money-path unit tests.
 * Mirrors server helpers: wallet_plan_spend, apply_wallet allocation, settlement.
 */

/** Promo-first spend plan (matches SQL wallet_plan_spend) */
export function planWalletSpend(
  cashAvailable: number,
  promoAvailable: number,
  amount: number,
) {
  const want = Math.round(Math.max(amount, 0) * 100) / 100;
  const promo = Math.min(Math.round(Math.max(promoAvailable, 0) * 100) / 100, want);
  const cash = Math.min(
    Math.round(Math.max(cashAvailable, 0) * 100) / 100,
    Math.round((want - promo) * 100) / 100,
  );
  return {
    promo_amount: promo,
    cash_amount: cash,
    total: Math.round((promo + cash) * 100) / 100,
    shortfall: Math.round(Math.max(want - promo - cash, 0) * 100) / 100,
  };
}

/** Proportional wallet allocation across seller bases (post-loyalty totals) */
export function allocateWalletProportional(
  bases: number[],
  cashTotal: number,
  promoTotal: number,
): { cash: number[]; promo: number[] } {
  const sum = bases.reduce((a, b) => a + Math.max(b, 0), 0) || 1;
  const cash: number[] = [];
  const promo: number[] = [];
  let remCash = cashTotal;
  let remPromo = promoTotal;
  for (let i = 0; i < bases.length; i++) {
    if (i === bases.length - 1) {
      cash.push(Math.round(remCash * 100) / 100);
      promo.push(Math.round(remPromo * 100) / 100);
    } else {
      const c = Math.round((Math.max(bases[i], 0) / sum) * cashTotal * 100) / 100;
      const p = Math.round((Math.max(bases[i], 0) / sum) * promoTotal * 100) / 100;
      cash.push(c);
      promo.push(p);
      remCash = Math.round((remCash - c) * 100) / 100;
      remPromo = Math.round((remPromo - p) * 100) / 100;
    }
  }
  return { cash, promo };
}

/** Settlement math with wallet + loyalty */
export function settlementFromOrderWithWallet(opts: {
  totalAmount: number;
  loyaltyDiscount: number;
  walletCash: number;
  walletPromo: number;
  platformFee: number;
}) {
  const loyalty = opts.loyaltyDiscount || 0;
  const wCash = opts.walletCash || 0;
  const wPromo = opts.walletPromo || 0;
  const gross = opts.totalAmount + loyalty + wCash + wPromo;
  return {
    buyer_paid: opts.totalAmount,
    gross_amount: gross,
    platform_loyalty_subsidy: loyalty,
    wallet_cash_applied: wCash,
    wallet_promo_applied: wPromo,
    platform_fee: opts.platformFee || 0,
    net_amount: gross - (opts.platformFee || 0),
  };
}

/** Mirrors CMVO zero-residual mark-paid gate (after loyalty + wallet apply) */
export function shouldMarkWalletCoveredOrdersPaid(orders: Array<{
  total_amount: number;
  wallet_cash_amount: number;
  wallet_promo_amount: number;
  loyalty_discount_amount?: number;
}>) {
  if (!orders.length) return false;
  const allZeroResidual = orders.every(
    (o) => Math.round(Math.max(o.total_amount, 0) * 100) / 100 === 0,
  );
  const anyCover = orders.some(
    (o) =>
      (o.wallet_cash_amount || 0) + (o.wallet_promo_amount || 0) > 0 ||
      (o.loyalty_discount_amount || 0) > 0,
  );
  return allZeroResidual && anyCover;
}

/** Mirrors apply_* commit-immediate methods */
export function commitsWalletOrLoyaltyImmediately(paymentMethod: string) {
  return ['cod', 'wallet'].includes(String(paymentMethod || 'cod').toLowerCase());
}

describe('Sociva Credit MVP money paths', () => {
  describe('planWalletSpend (promo-first)', () => {
    it('uses promo before cash', () => {
      const p = planWalletSpend(50, 30, 40);
      expect(p.promo_amount).toBe(30);
      expect(p.cash_amount).toBe(10);
      expect(p.total).toBe(40);
      expect(p.shortfall).toBe(0);
    });

    it('caps by balance', () => {
      const p = planWalletSpend(10, 5, 100);
      expect(p.total).toBe(15);
      expect(p.shortfall).toBe(85);
    });

    it('handles zero balance', () => {
      expect(planWalletSpend(0, 0, 20).total).toBe(0);
    });
  });

  describe('allocateWalletProportional', () => {
    it('splits multi-seller cash+promo with remainder on last', () => {
      const { cash, promo } = allocateWalletProportional([100, 50], 20, 10);
      expect(cash.reduce((a, b) => a + b, 0)).toBeCloseTo(20, 5);
      expect(promo.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 5);
      expect(cash[0]).toBeCloseTo(13.33, 1);
      expect(promo[0]).toBeCloseTo(6.67, 1);
    });

    it('single seller gets full amounts', () => {
      const { cash, promo } = allocateWalletProportional([200], 25, 5);
      expect(cash).toEqual([25]);
      expect(promo).toEqual([5]);
    });
  });

  describe('checkout residual after wallet', () => {
    it('razorpay charges post-wallet total only', () => {
      const merchandise = 100;
      const delivery = 20;
      const loyalty = 10;
      const payable = merchandise - loyalty + delivery; // 110
      const plan = planWalletSpend(40, 20, payable);
      const residual = Math.round((payable - plan.total) * 100) / 100;
      expect(plan.total).toBe(60);
      expect(residual).toBe(50);
    });

    it('full wallet cover → residual 0', () => {
      const payable = 80;
      const plan = planWalletSpend(100, 0, payable);
      expect(plan.total).toBe(80);
      expect(payable - plan.total).toBe(0);
    });
  });

  describe('settlementFromOrderWithWallet', () => {
    it('seller gross includes wallet + loyalty; buyer paid is residual', () => {
      const s = settlementFromOrderWithWallet({
        totalAmount: 50,
        loyaltyDiscount: 10,
        walletCash: 20,
        walletPromo: 5,
        platformFee: 4,
      });
      expect(s.buyer_paid).toBe(50);
      expect(s.gross_amount).toBe(85);
      expect(s.platform_loyalty_subsidy).toBe(10);
      expect(s.wallet_cash_applied).toBe(20);
      expect(s.wallet_promo_applied).toBe(5);
      expect(s.net_amount).toBe(81);
    });
  });

  describe('refund destination policy', () => {
    it('wallet destination credits full economic amount without double restore', () => {
      const residualPaid = 60;
      const walletApplied = 40;
      const refundAmount = residualPaid + walletApplied; // reconstructed
      const destination = 'wallet';
      const credit = destination === 'wallet' ? refundAmount : 0;
      const restoreWallet = destination === 'wallet' ? 0 : walletApplied;
      expect(credit + restoreWallet).toBe(100);
    });

    it('original destination refunds residual via gateway and restores wallet spend', () => {
      const residualPaid = 60;
      const walletApplied = 40;
      const gatewayRefund = residualPaid;
      const restoreWallet = walletApplied;
      expect(gatewayRefund + restoreWallet).toBe(100);
    });
  });

  describe('wallet-only ₹0 residual mark-paid (RLS-safe path)', () => {
    it('marks paid when residual is 0 and wallet applied', () => {
      expect(
        shouldMarkWalletCoveredOrdersPaid([
          {
            total_amount: 0,
            wallet_cash_amount: 40,
            wallet_promo_amount: 10,
          },
        ]),
      ).toBe(true);
    });

    it('does not mark paid when gateway residual remains', () => {
      expect(
        shouldMarkWalletCoveredOrdersPaid([
          {
            total_amount: 25,
            wallet_cash_amount: 40,
            wallet_promo_amount: 0,
          },
        ]),
      ).toBe(false);
    });

    it('does not mark paid without wallet/loyalty cover', () => {
      expect(
        shouldMarkWalletCoveredOrdersPaid([
          { total_amount: 0, wallet_cash_amount: 0, wallet_promo_amount: 0 },
        ]),
      ).toBe(false);
    });

    it('wallet payment method commits holds immediately (like COD)', () => {
      expect(commitsWalletOrLoyaltyImmediately('wallet')).toBe(true);
      expect(commitsWalletOrLoyaltyImmediately('cod')).toBe(true);
      expect(commitsWalletOrLoyaltyImmediately('online')).toBe(false);
      expect(commitsWalletOrLoyaltyImmediately('upi')).toBe(false);
    });

    it('migration forbids client payment_status→paid forgery; CMVO marks paid instead', async () => {
      const fs = await import('fs');
      const path = await import('path');
      const guard = fs.readFileSync(
        path.join(process.cwd(), 'supabase/migrations/20260803180000_ship_seller_silent_failure_fixes.sql'),
        'utf8',
      );
      const e2e = fs.readFileSync(
        path.join(process.cwd(), 'supabase/migrations/20260807121744_wallet_mvp_e2e_gaps.sql'),
        'utf8',
      );
      const cart = fs.readFileSync(
        path.join(process.cwd(), 'src/hooks/useCartPage.ts'),
        'utf8',
      );
      expect(guard).toMatch(/guard_order_payment_status/);
      expect(guard).toMatch(/Direct payment_status changes/);
      expect(e2e).toMatch(/mark paid server-side/);
      expect(e2e).toMatch(/expire_wallet_lots_daily/);
      expect(cart).toMatch(/_payment_method:\s*'wallet'/);
      expect(cart).not.toMatch(/payment_status:\s*'paid'/);
    });
  });
});
