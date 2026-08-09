import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('wallet financial operations controls', () => {
  const migration = read(
    'supabase/migrations/20260808062611_wallet_financial_operations.sql',
  );
  const refundContainment = read(
    'supabase/migrations/20260808140000_revoke_complete_refund_public.sql',
  );
  const refundFailureContainment = read(
    'supabase/migrations/20260808141000_revoke_fail_refund_public.sql',
  );
  const financialFunctionAcl = read(
    'supabase/migrations/20260808142000_financial_function_anon_acl.sql',
  );
  const reviewedClientRpcs = read(
    'supabase/migrations/20260808143000_restore_reviewed_financial_client_rpcs.sql',
  );
  const settlementWorker = read(
    'supabase/functions/process-settlements/index.ts',
  );
  const sellerPayouts = read('src/pages/SellerPayoutsPage.tsx');
  const adminAnalytics = read('src/hooks/queries/useAdminAnalytics.ts');
  const adminTracePage = read('src/pages/AdminFinancialTracePage.tsx');
  const app = read('src/App.tsx');
  const webhook = read('supabase/functions/razorpay-webhook/index.ts');
  const refundProcessor = read('supabase/functions/refund-processor/index.ts');
  const refundCard = read('src/components/refund/RefundRequestCard.tsx');

  it('binds wallet reservation retries to the same buyer and payload', () => {
    expect(migration).toMatch(/idempotency_key_payload_mismatch/);
    expect(migration).toMatch(/r\.user_id IS DISTINCT FROM _uid/);
    expect(migration).toMatch(/requested_amount/);
    expect(migration).toMatch(/wallet-reservation:/);
    expect(migration).toMatch(/FROM public\.buyer_wallets[\s\S]*FOR UPDATE/);
  });

  it('validates exact refund payment, amount, and provider identity', () => {
    expect(webhook).toMatch(/expectedAttempt\.provider_payment_id !== paymentId/);
    expect(webhook).toMatch(/providerAmountMinor !== Number\(expectedAttempt\.amount_minor\)/);
    expect(webhook).toMatch(/refund_identity_or_amount_mismatch/);
    expect(migration).toMatch(/exact_refund_attempt_not_found/);
  });

  it('requires a different checker for control changes and adjustments', () => {
    expect(migration).toMatch(/maker cannot approve own financial control change/);
    expect(migration).toMatch(/maker cannot approve own financial adjustment/);
    expect(migration).toMatch(/financial_control_change_approved/);
    expect(migration).toMatch(/financial_adjustment_posted/);
  });

  it('fails closed when a financial control is enabled directly', () => {
    expect(migration).toMatch(/financial feature enable requires approved maker-checker request/);
    expect(migration).toMatch(/financial provider mode enable requires approved maker-checker request/);
    expect(migration).toMatch(/app\.financial_control_approved/);
  });

  it('requires a verified cooled destination and enforces payout limits', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.seller_payout_destinations/);
    expect(migration).toMatch(/destination_cooling_period/);
    expect(migration).toMatch(/payout_limit_exceeded/);
    expect(migration).toMatch(/daily_amount_minor/);
    expect(migration).toMatch(/weekly_amount_minor/);
    expect(migration).toMatch(/monthly_amount_minor/);
    expect(migration).toMatch(/pg_advisory_xact_lock/);
    expect(settlementWorker).toMatch(/destination_provider_reference/);
  });

  it('blocks refund approval during payouts and hides disabled wallet refunds', () => {
    expect(migration).toMatch(
      /NEW\.refund_state IN \([\s\S]*'approved', 'refund_initiated', 'refund_processing'/,
    );
    expect(migration).toMatch(/wallet refund credit is disabled/);
    expect(refundCard).toMatch(/walletRefundEnabled &&/);
    expect(refundProcessor).toMatch(/wallet_refund_credit_disabled/);
    expect(refundProcessor).toMatch(/deduplicated: refundAttempt\?\.deduplicated === true/);
    expect(migration).toMatch(/No provider rail exists to refund/);
  });

  it('verifies payout identity and preserves terminal success', () => {
    expect(settlementWorker).toMatch(/razorpay_transfer_identity_mismatch/);
    expect(webhook).toMatch(/transfer_identity_or_amount_mismatch/);
    expect(webhook).toMatch(/attempt\.status === 'succeeded'/);
    expect(migration).toMatch(/succeeded payout attempt is immutable/);
    expect(migration).toMatch(/terminal_succeeded_attempt/);
  });

  it('uses server-authoritative seller and admin projections', () => {
    expect(migration).toMatch(/FUNCTION public\.get_seller_financial_summary/);
    expect(migration).toMatch(/FUNCTION public\.get_admin_financial_overview/);
    expect(sellerPayouts).toMatch(/get_seller_financial_summary/);
    expect(sellerPayouts).not.toMatch(/settlement totals RPC fallback/);
    expect(adminAnalytics).toMatch(/get_admin_financial_overview/);
    expect(adminAnalytics).not.toMatch(/let allOrders/);
  });

  it('provides an admin-only one-reference financial trace', () => {
    expect(migration).toMatch(/FUNCTION public\.get_admin_financial_trace/);
    expect(migration).toMatch(/NOT public\.is_admin\(auth\.uid\(\)\)/);
    expect(adminTracePage).toMatch(/get_admin_financial_trace/);
    expect(app).toMatch(/path="\/admin\/financial-trace"/);
  });

  it('raises durable alerts for reconciliation exceptions', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.financial_alerts/);
    expect(migration).toMatch(/reconciliation_mismatch/);
    expect(migration).toMatch(/trg_raise_financial_exception_alert/);
  });

  it('removes direct payment inserts and internal wallet execution', () => {
    expect(migration).toMatch(
      /REVOKE INSERT ON TABLE public\.payment_records FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.credit_wallet_cash[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.wallet_insert_entry[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.complete_wallet_refund\(uuid\)[\s\S]*TO service_role/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_buyer_wallet\(uuid\)[\s\S]*TO authenticated, service_role/,
    );
    expect(refundContainment).toMatch(/p\.proname = 'complete_refund'/);
    expect(refundContainment).toMatch(
      /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/,
    );
    expect(refundContainment).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
    expect(refundFailureContainment).toMatch(/p\.proname = 'fail_refund'/);
    expect(refundFailureContainment).toMatch(
      /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/,
    );
    expect(refundFailureContainment).toMatch(
      /GRANT EXECUTE ON FUNCTION %s TO service_role/,
    );
    expect(financialFunctionAcl).toMatch(
      /REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon/,
    );
    expect(financialFunctionAcl).toMatch(/p\.proname <> 'get_public_payment_mode'/);
    expect(financialFunctionAcl).toMatch(/'fn_populate_payment_record_impl'/);
    expect(financialFunctionAcl).toMatch(/'commit_wallet_reservation'/);
    expect(reviewedClientRpcs).toMatch(/'confirm_cod_payment'/);
    expect(reviewedClientRpcs).toMatch(
      /GRANT EXECUTE ON FUNCTION %s TO authenticated/,
    );
  });
});
