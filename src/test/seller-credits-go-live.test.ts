import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildSellerCreditsGoLiveChecks, goLiveChecksAllowSpend } from '@/lib/sellerCreditsGoLive';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Seller credits go-live safety', () => {
  it('blocks spend enable when checklist is incomplete', () => {
    const checks = buildSellerCreditsGoLiveChecks({
      purchaseEnabled: true,
      spendEnabled: false,
      resolutionReady: true,
      capturedPurchaseCount: 1,
      purchaseLedgerCount: 1,
    });
    expect(goLiveChecksAllowSpend(checks)).toBe(false);
    expect(checks.find((c) => c.id === 'duplicate_confirm')?.status).toBe('manual');
  });

  it('allows spend enable when live + isolated evidence passes', () => {
    const checks = buildSellerCreditsGoLiveChecks({
      purchaseEnabled: true,
      spendEnabled: false,
      resolutionReady: true,
      capturedPurchaseCount: 1,
      purchaseLedgerCount: 1,
      evidence: {
        productionVerifyOk: true,
        productionCases: [
          { id: 'live_duplicate_confirm', result: 'PASS' },
          { id: 'live_purchase_ledger', result: 'PASS' },
          { id: 'live_purchase_notification', result: 'PASS' },
        ],
        isolatedCertOk: true,
        isolatedCases: [
          { id: 'enquiry_charge', result: 'PASS' },
          { id: 'enquiry_insufficient_block', result: 'PASS' },
          { id: 'contact_debounce_no_duplicate', result: 'PASS' },
          { id: 'order_reserve_commit', result: 'PASS' },
          { id: 'booking_reserve_release', result: 'PASS' },
          { id: 'purchase_refund_unused', result: 'PASS' },
        ],
      },
    });
    expect(goLiveChecksAllowSpend(checks)).toBe(true);
    expect(checks.find((c) => c.id === 'billing_e2e')?.status).toBe('pass');
    expect(checks.find((c) => c.id === 'refund_path')?.status).toBe('pass');
  });

  it('fails spend-off check when spend is on', () => {
    const checks = buildSellerCreditsGoLiveChecks({
      purchaseEnabled: true,
      spendEnabled: true,
      resolutionReady: true,
    });
    expect(checks.find((c) => c.id === 'spend_off')?.status).toBe('fail');
  });

  it('admin UI enables spend only when the go-live checklist is fully green', () => {
    const admin = read('src/pages/AdminSellerCreditsPage.tsx');
    expect(admin).toMatch(/Spend is blocked until the go-live checklist below is fully green/);
    expect(admin).toMatch(/spendReady: spendGoLiveReady/);
    expect(admin).toMatch(/Turn Spend ON\?/);
    expect(admin).toMatch(/Run billing certification/);
    expect(admin).toMatch(/Unified financial timeline/);
    expect(admin).toMatch(/admin_list_seller_credit_financial_timeline/);
    expect(admin).toMatch(/Checklist is green — you can turn Spend \/ gating ON/);
  });

  it('confirm RPC inserts ledger before marking captured', () => {
    const sql = read('supabase/migrations/20260822190000_seller_credits_confirm_atomicity.sql');
    expect(sql).toMatch(/RETURNING id INTO v_led_id/);
    expect(sql).toMatch(/credit issuance incomplete/);
    expect(sql).toMatch(/IF v_led_id IS NOT NULL THEN/);
  });

  it('confirmer does not select a currency column from purchases', () => {
    const confirm = read('supabase/functions/confirm-seller-credit-payment/index.ts');
    expect(confirm).toMatch(/select\("id, seller_id, amount, status, provider_order_id, provider_payment_id"\)/);
    expect(confirm).not.toMatch(/seller_credit_purchases\.currency/);
  });

  it('cert reconciliation uses last ledger balance not raw sum', () => {
    const sql = read('supabase/migrations/20260822210000_seller_credits_gap_closeout.sql');
    expect(sql).toMatch(/last_ledger_balance/);
    expect(sql).toMatch(/v_acct_a.reserved = 0/);
    expect(sql).toMatch(/v_max numeric := 50000/);
  });
});
