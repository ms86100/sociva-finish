import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buyerRiskAdvisoryCopy,
  buyerRiskBandLabel,
  normalizeBuyerRefundRiskProfile,
} from '@/lib/buyer-refund-risk';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('sociva credit refund migration', () => {
  const migration = read('supabase/migrations/20260828240000_sociva_credit_refund_and_buyer_risk.sql');
  const paymentModeMigration = read('supabase/migrations/20260828250000_payment_mode_refund_eligibility.sql');

  it('defines seller_respond_refund with partial + wallet path', () => {
    expect(migration).toMatch(/FUNCTION public\.seller_respond_refund/);
    expect(migration).toMatch(/approve_partial/);
    expect(migration).toMatch(/complete_wallet_refund/);
  });

  it('payment-mode migration gates wallet refunds centrally', () => {
    expect(paymentModeMigration).toMatch(/get_sociva_balance_refund_eligibility/);
    expect(paymentModeMigration).toMatch(/v_use_wallet := COALESCE/);
  });

  it('enables wallet_refund_credit_enabled with financial control approval', () => {
    expect(migration).toMatch(/wallet_refund_credit_enabled/);
    expect(migration).toMatch(/app\.financial_control_approved/);
  });

  it('exposes buyer risk profile RPC and nightly cron', () => {
    expect(migration).toMatch(/get_buyer_refund_risk_profile/);
    expect(migration).toMatch(/buyer_refund_risk_nightly/);
    expect(migration).toMatch(/recompute_all_buyer_refund_risks/);
  });
});

describe('buyer refund risk UI helpers', () => {
  it('normalizes RPC payload', () => {
    const profile = normalizeBuyerRefundRiskProfile({
      buyer_id: 'abc',
      score: 42.3,
      band: 'medium',
      recommendation: 'Review carefully.',
      features: { orders_n: 5, refunds_k: 2 },
    });
    expect(profile?.band).toBe('medium');
    expect(profile?.score).toBe(42.3);
    expect(profile?.features?.orders_n).toBe(5);
  });

  it('maps band labels and advisory copy', () => {
    expect(buyerRiskBandLabel('low')).toBe('Low risk');
    expect(buyerRiskAdvisoryCopy({ score: 80, band: 'high', recommendation: '' }))
      .toMatch(/abuse/i);
  });
});

describe('seller refund UI wiring', () => {
  const sellerActions = read('src/components/refund/SellerRefundActions.tsx');
  const refundCard = read('src/components/refund/RefundRequestCard.tsx');

  it('seller actions call seller_respond_refund', () => {
    expect(sellerActions).toMatch(/seller_respond_refund/);
    expect(sellerActions).toMatch(/BuyerTrustProfileCard/);
    expect(sellerActions).toMatch(/approve_partial/);
  });

  it('buyer refund card uses server-side destination selection', () => {
    expect(refundCard).toMatch(/get_sociva_balance_refund_eligibility/);
    expect(refundCard).not.toMatch(/p_refund_destination: 'wallet'/);
  });
});
