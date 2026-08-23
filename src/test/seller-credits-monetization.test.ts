import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { creditLedgerLabel, creditHealth } from '@/lib/sellerCredits';
import { pickNotificationRoute } from '@/lib/notification-routes';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Seller credits monetization integrity', () => {
  it('does not select a non-existent purchase currency column', () => {
    const confirm = read('supabase/functions/confirm-seller-credit-payment/index.ts');
    expect(confirm).toMatch(/select\("id, seller_id, amount, status, provider_order_id, provider_payment_id"\)/);
    expect(confirm).not.toMatch(/amount, currency, status/);
    expect(confirm).toMatch(/verifyRazorpayCheckoutSignature/);
    expect(confirm).toMatch(/source !== "webhook"/);
  });

  it('maps Razorpay authentication failed to a seller-safe gateway message', () => {
    const orderFn = read('supabase/functions/create-seller-credit-order/index.ts');
    expect(orderFn).toMatch(/authentication failed/i);
    expect(orderFn).toMatch(/attach provider order failed/);
    expect(orderFn).toMatch(/RAZORPAY_GATEWAY_AUTH_FAILED/);
  });

  it('binds confirmation to purchase notes when the order row was not attached', () => {
    const confirm = read('supabase/functions/confirm-seller-credit-payment/index.ts');
    expect(confirm).toMatch(/candidateId = notePurchaseId \|\| clientPurchaseId/);
    expect(read('src/pages/SellerCreditsPage.tsx')).toMatch(/razorpayCheckoutPrefill/);
    expect(read('src/pages/SellerCreditsPage.tsx')).toMatch(/openNativeRazorpayCheckout/);
    expect(read('src/pages/SellerCreditsPage.tsx')).not.toMatch(/prefill: \{ email: user\?\.email/);
  });

  it('issues credits only with a purchase ledger and self-heals captured-without-ledger', () => {
    const sql = read('supabase/migrations/20260822130301_seller_credits_purchase_integrity.sql');
    expect(sql).toMatch(/confirm_seller_credit_purchase/);
    expect(sql).toMatch(/v_led_id IS NOT NULL/);
    expect(sql).toMatch(/reference_type = 'credit_purchase'/);
    expect(sql).toMatch(/refund_seller_credit_purchase/);
    expect(sql).toMatch(/SELLER_CREDIT_REFUND_INSUFFICIENT/);
    expect(sql).toMatch(/p_request_id/);
    expect(sql).toMatch(/balance_before/);
    expect(sql).toMatch(/admin_list_reversible_seller_charges/);
    expect(sql).toMatch(/IF NOT public\.seller_credit_spend_active\(\)/);
    expect(sql).not.toMatch(/seller_credit_spend_enabled',\s*true/);
  });

  it('handles seller-credit refunds separately from buyer wallet refunds', () => {
    const webhook = read('supabase/functions/razorpay-webhook/index.ts');
    expect(webhook).toMatch(/sellerCreditRefundEvent/);
    expect(webhook).toMatch(/refund_seller_credit_purchase/);
    expect(webhook).not.toMatch(/useWalletCredit/);
  });

  it('explains admin controls and does not present charge as a distinct no-show policy', () => {
    const admin = read('src/pages/AdminSellerCreditsPage.tsx');
    expect(admin).toMatch(/Configuration history/);
    expect(admin).toMatch(/Financial activity/);
    expect(admin).toMatch(/Charge reversal/);
    expect(admin).toMatch(/unresolved_after_grace_policy/);
    expect(admin).toMatch(/contact_debounce_hours/);
    expect(admin).toMatch(/Buyer no-show: commit reserved credits/);
    expect(admin).toMatch(/Buyer no-show: release reservation/);
    expect(admin).not.toMatch(/option value="charge"/);
    expect(admin).toMatch(/Unified financial timeline/);
    expect(admin).toMatch(/Run billing certification/);
    expect(admin).toMatch(/Spend is OFF/);
    expect(admin).toMatch(/Spend cannot be enabled from Admin/);
    expect(admin).toMatch(/Store lookup/);
    expect(admin).toMatch(/AdminStoreSearchPicker/);
    expect(admin).not.toMatch(/const adminRpc = supabase\.rpc/);
    expect(admin).toMatch(/supabase\.rpc\(name as never/);
    expect(admin).toMatch(/Low\/critical boundary/);
    expect(admin).toMatch(/Deactivate/);
  });

  it('keeps spend-off messaging accurate: discovery still needs credits', () => {
    const credits = read('src/pages/SellerCreditsPage.tsx');
    const card = read('src/components/seller/SocivaCreditsCard.tsx');
    expect(credits).toMatch(/summary\?\.spendEnabled/);
    expect(credits).toMatch(/positive credit balance is still required for discovery|make your products visible/);
    expect(card).toMatch(/summary\?\.spendEnabled/);
    expect(card).toMatch(/make your store visible/);
  });

  it('labels refunds and routes refund notifications to credits', () => {
    expect(creditLedgerLabel('refund')).toBe('Purchase refund');
    expect(pickNotificationRoute({ type: 'seller_credit_refunded' })).toBe('/seller/credits');
    expect(creditHealth(25, { healthyMin: 100, lowMin: 50, criticalMin: 1 })).toBe('critical');
    expect(creditHealth(75, { healthyMin: 100, lowMin: 50, criticalMin: 1 })).toBe('low');
  });
});
