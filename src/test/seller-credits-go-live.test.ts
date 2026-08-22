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

  it('fails spend-off check when spend is on', () => {
    const checks = buildSellerCreditsGoLiveChecks({
      purchaseEnabled: true,
      spendEnabled: true,
      resolutionReady: true,
    });
    expect(checks.find((c) => c.id === 'spend_off')?.status).toBe('fail');
  });

  it('admin UI blocks spend enable from the panel', () => {
    const admin = read('src/pages/AdminSellerCreditsPage.tsx');
    expect(admin).toMatch(/Spend cannot be enabled from Admin until every go-live checklist/);
    expect(admin).toMatch(/Spend is blocked until the go-live checklist below is fully green/);
    expect(admin).not.toMatch(/Turn Spend ON\?/);
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
});
