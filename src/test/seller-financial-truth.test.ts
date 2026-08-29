import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  activityLabel,
  emptySellerFinancialSummary,
  isFullOrderRefund,
  isWithdrawableSource,
  mapSellerFinancialSummary,
  orderPaymentStatusAfterRefund,
  paidOutRequiresTransferRef,
  remainingPayableAfterRefund,
} from '@/lib/sellerFinancialTruth';
import { pickNotificationRoute } from '@/lib/notification-routes';
import { settledGmvAmount } from '@/lib/seller-order-board';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('seller financial truth', () => {
  it('maps payable buckets without mixing Settled GMV', () => {
    const summary = mapSellerFinancialSummary({
      pending: 10,
      available: 40,
      reserved: 5,
      on_hold: 2,
      paid_out: 20,
      legacy_settled_unverified: 3,
      refunded: 8,
      cod_expected: 15,
      cod_collected: 25,
    });
    expect(summary.available).toBe(40);
    expect(summary.withdrawable).toBe(40);
    expect(summary.totalEarned).toBe(80);
    expect(summary.codCollected).toBe(25);
    expect(emptySellerFinancialSummary().available).toBe(0);
  });

  it('never treats COD cash as withdrawable', () => {
    expect(isWithdrawableSource({ collector_type: 'seller', not_withdrawable: true })).toBe(false);
    expect(isWithdrawableSource({ not_withdrawable: true })).toBe(false);
    expect(isWithdrawableSource({ collector_type: 'platform' })).toBe(true);
    expect(activityLabel('cod')).toMatch(/not withdrawable/i);
  });

  it('reduces payable and GMV by the refunded amount only', () => {
    expect(remainingPayableAfterRefund(500, 120)).toBe(380);
    expect(isFullOrderRefund(500, 120)).toBe(false);
    expect(isFullOrderRefund(500, 500)).toBe(true);
    expect(orderPaymentStatusAfterRefund('paid', 500, 120)).toBe('paid');
    expect(orderPaymentStatusAfterRefund('paid', 500, 500)).toBe('refunded');
    expect(settledGmvAmount('completed', 'paid', 500, 120)).toBe(380);
    expect(settledGmvAmount('completed', 'refunded', 500, 0)).toBe(0);
    expect(settledGmvAmount('preparing', 'paid', 500, 0)).toBe(0);
  });

  it('requires a transfer reference before paid-out truth', () => {
    expect(paidOutRequiresTransferRef('settled', 'UTR123')).toBe(true);
    expect(paidOutRequiresTransferRef('settled', null)).toBe(false);
    expect(paidOutRequiresTransferRef('eligible', 'UTR123')).toBe(false);
  });

  it('routes settlement and transfer notices to the seller wallet', () => {
    expect(pickNotificationRoute({ type: 'settlement' })).toBe('/seller/wallet');
    expect(pickNotificationRoute({ type: 'seller_transfer' })).toBe('/seller/wallet');
    expect(pickNotificationRoute({ type: 'settlement', reference_path: '/seller/settlements' })).toBe('/seller/wallet');
  });

  it('fails financial KPIs transparently instead of a 90-day fallback', () => {
    const hook = read('src/hooks/queries/useSellerOrders.ts');
    expect(hook).not.toMatch(/fetchKpisClientFallback/);
    expect(hook).toMatch(/if \(error\) throw error/);
    expect(hook).toMatch(/Financial totals fail transparently/);
    expect(hook).toMatch(/get_seller_dashboard_kpis/);
  });

  it('keeps GMV and payable on separate read paths', () => {
    const summary = read('src/components/seller/EarningsSummary.tsx');
    const wallet = read('src/pages/SellerWalletPage.tsx');
    const earnings = read('src/pages/SellerEarningsPage.tsx');
    const finance = read('src/hooks/queries/useSellerFinancial.ts');
    const sql = read('supabase/migrations/20260822052544_seller_financial_truth_wallet.sql');
    expect(summary).toMatch(/Sales/);
    expect(summary).toMatch(/Ready to withdraw/);
    expect(wallet).toMatch(/get_seller_financial_summary|useSellerFinancialSummary/);
    expect(earnings).toMatch(/get_seller_dashboard_kpis/);
    expect(earnings).toMatch(/not seller payable|not withdrawable earnings/i);
    expect(finance).toMatch(/get_seller_financial_summary/);
    expect(sql).toMatch(/Do not enable seller_payout_enabled/);
    expect(sql).toMatch(/UTR \/ transfer reference is required/);
    expect(sql).toMatch(/Partial refund/);
    expect(sql).toMatch(/\/seller\/wallet/);
  });
});
