import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

const section = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
};

describe('wallet certification controls', () => {
  const hardening = read(
    'supabase/migrations/20260808055445_wallet_financial_hardening.sql',
  );
  const paymentTruth = read(
    'supabase/migrations/20260808131000_attempt_aware_payment_truth.sql',
  );
  const payoutGates = read(
    'supabase/migrations/20260808132000_cod_and_payout_release_gates.sql',
  );
  const runtimeJournals = read(
    'supabase/migrations/20260808133000_canonical_runtime_journals.sql',
  );
  const externalReconciliation = read(
    'supabase/migrations/20260808134000_external_reconciliation_and_evidence.sql',
  );
  const refundBoundaries = read(
    'supabase/migrations/20260808135000_refund_liability_chargeback_boundaries.sql',
  );
  const webhook = read('supabase/functions/razorpay-webhook/index.ts');
  const credentials = read('supabase/functions/_shared/credentials.ts');
  const signatureVerifier = read(
    'supabase/functions/_shared/razorpay-signature.ts',
  );
  const recovery = read('supabase/functions/recover-financial-operations/index.ts');
  const reconcileWorker = read('supabase/functions/reconcile-financials/index.ts');
  const refundProcessor = read('supabase/functions/refund-processor/index.ts');
  const settlementProcessor = read('supabase/functions/process-settlements/index.ts');
  const walletHook = read('src/hooks/useWalletCredit.ts');

  it('keeps failed and captured attempts independent and makes capture terminal', () => {
    const registerAttempt = section(
      paymentTruth,
      'CREATE OR REPLACE FUNCTION finance.register_payment_attempt_event',
      'CREATE OR REPLACE FUNCTION public.register_payment_attempt_event',
    );
    expect(paymentTruth).toMatch(/UNIQUE\(provider, provider_payment_id\)/);
    expect(registerAttempt).toMatch(
      /IF v_attempt\.status = 'captured' AND p_status <> 'captured' THEN[\s\S]*ignored_stale_event/,
    );
    expect(registerAttempt).toMatch(
      /SET status = p_status,[\s\S]*captured_at = CASE WHEN p_status = 'captured'/,
    );
    expect(registerAttempt).not.toMatch(
      /v_attempt\.status = 'failed' AND p_status = 'captured'[\s\S]*RETURN/,
    );

    const failedBranch = section(
      webhook,
      "event === 'payment.failed'",
      "event === 'transfer.processed'",
    );
    expect(failedBranch).toMatch(/p_status:\s*'failed'/);
    expect(failedBranch).toMatch(/order truth unchanged/);
    expect(failedBranch).not.toMatch(/confirm-razorpay-payment|payment_status/);

    const capturedBranch = section(
      webhook,
      "event === 'payment.captured'",
      "event === 'payment.failed'",
    );
    expect(capturedBranch.indexOf("'register_payment_attempt_event'")).toBeLessThan(
      capturedBranch.indexOf('confirm-razorpay-payment'),
    );
    expect(capturedBranch).toMatch(/p_status:\s*'captured'/);
    expect(paymentTruth).toMatch(
      /razorpay_order_id IS DISTINCT FROM p_provider_order_id[\s\S]*captured payment provider order binding mismatch/,
    );
    expect(paymentTruth).toMatch(
      /checkout_group_id IS DISTINCT FROM p_checkout_group_id[\s\S]*checkout group does not own every linked order/,
    );
  });

  it('uses the dedicated webhook secret and constant-time HMAC over the raw body', () => {
    expect(credentials).toMatch(
      /getCredential\([\s\S]*"razorpay_webhook_secret",[\s\S]*"RAZORPAY_WEBHOOK_SECRET"/,
    );
    const secretResolver = section(
      credentials,
      'export async function getRazorpayWebhookSecret',
      '/** Create a service-role Supabase client',
    );
    expect(secretResolver).not.toMatch(/razorpay_key_secret|RAZORPAY_KEY_SECRET/);

    expect(signatureVerifier).toMatch(/\{ name: 'HMAC', hash: 'SHA-256' \}/);
    expect(signatureVerifier).toMatch(
      /crypto\.subtle\.sign\([\s\S]*encoder\.encode\(body\)/,
    );
    expect(signatureVerifier).toMatch(/expected\.length !== supplied\.length/);
    expect(signatureVerifier).toMatch(
      /difference \|= expected\[index\] \^ supplied\[index\]/,
    );
    expect(webhook).toMatch(/verifyRazorpaySignature\(body, signature, webhookSecret\)/);
    expect(webhook).toMatch(/if \(!webhookSecret\)[\s\S]*status: 503/);
    expect(webhook).toMatch(/if \(!signature\)[\s\S]*status: 401/);
    expect(webhook.indexOf('const body = await req.text()')).toBeLessThan(
      webhook.indexOf('JSON.parse(body)'),
    );
  });

  it('recovers crashes only through exact refund and payout linkage', () => {
    const refundRecovery = section(
      recovery,
      'for (const attempt of refunds || [])',
      'const { data: payouts',
    );
    expect(refundRecovery).toMatch(
      /refund_request_id[\s\S]*attempt\.refund_id[\s\S]*item\?\.amount[\s\S]*attempt\.amount_minor[\s\S]*item\?\.payment_id[\s\S]*attempt\.provider_payment_id/,
    );
    expect(refundRecovery).toMatch(
      /providerRefund\.amount[\s\S]*attempt\.amount_minor[\s\S]*providerRefund\.payment_id[\s\S]*attempt\.provider_payment_id/,
    );
    expect(refundRecovery).toMatch(/complete_refund_by_gateway_id/);

    const payoutRecovery = section(
      recovery,
      'for (const attempt of payouts || [])',
      'return new Response(JSON.stringify',
    );
    expect(payoutRecovery).toMatch(
      /transfer\.amount[\s\S]*attempt\.amount_minor[\s\S]*transfer\.currency[\s\S]*"INR"[\s\S]*transfer\.recipient \|\| transfer\.account[\s\S]*destination[\s\S]*transfer\.notes\?\.settlement_id[\s\S]*attempt\.settlement_id/,
    );
    expect(payoutRecovery).toMatch(/finalize_seller_payout/);
    expect(payoutRecovery).toMatch(/hold_failed_seller_payout/);
  });

  it('excludes COD from online seller payable and payout release', () => {
    const settlementCreation = section(
      payoutGates,
      'CREATE OR REPLACE FUNCTION public.create_settlement_on_delivery_impl',
      'CREATE OR REPLACE FUNCTION finance.enforce_payout_release_prerequisites',
    );
    const codReturn = settlementCreation.indexOf(
      "lower(COALESCE(p_new.payment_type, '')) IN",
    );
    const settlementInsert = settlementCreation.indexOf(
      'INSERT INTO public.seller_settlements',
    );
    expect(codReturn).toBeGreaterThan(0);
    expect(codReturn).toBeLessThan(settlementInsert);
    expect(settlementCreation).toMatch(/'cod', 'cash', 'cash_on_delivery'[\s\S]*RETURN;/);

    const payoutPrerequisites = section(
      payoutGates,
      'CREATE OR REPLACE FUNCTION finance.enforce_payout_release_prerequisites',
      'DROP TRIGGER IF EXISTS trg_enforce_payout_release_prerequisites',
    );
    expect(payoutPrerequisites).toMatch(
      /'cod', 'cash', 'cash_on_delivery'[\s\S]*payout blocked: COD is not platform-held online tender/,
    );
    const codJournal = section(
      runtimeJournals,
      'CREATE OR REPLACE FUNCTION finance.post_cod_financial_event',
      'DROP TRIGGER IF EXISTS trg_post_cod_financial_event',
    );
    expect(codJournal).toMatch(/COD_EXPECTED/);
    expect(codJournal).toMatch(/COD_COLLECTED/);
    expect(codJournal).not.toMatch(/seller_payable_(pending|available)/);
  });

  it('gates payouts on capture, reconciliation, destination, controls, and journals', () => {
    const prerequisites = section(
      payoutGates,
      'CREATE OR REPLACE FUNCTION finance.enforce_payout_release_prerequisites',
      'DROP TRIGGER IF EXISTS trg_enforce_payout_release_prerequisites',
    );
    for (const control of [
      'order payment is not paid',
      'settlement cooling period not complete',
      'complete captured allocation required',
      'capture allocation variance',
      'clean internal allocation reconciliation required',
      'exact external provider statement required',
      'refund conflict',
      'verified destination required',
      'destination cooling period',
      'money movement gate disabled',
    ]) {
      expect(prerequisites).toContain(control);
    }
    expect(prerequisites).toMatch(/difference_minor = 0/);
    expect(prerequisites).toMatch(/provider_payout_mode[\s\S]*razorpay_route_deferred/);

    const payoutJournal = section(
      payoutGates,
      'CREATE OR REPLACE FUNCTION finance.post_payout_attempt_journal',
      'DROP TRIGGER IF EXISTS trg_post_payout_attempt_journal',
    );
    expect(payoutJournal).toMatch(
      /TG_OP = 'INSERT'[\s\S]*PAYOUT_RESERVED[\s\S]*seller_payable_available[\s\S]*settlement_in_transit/,
    );
    expect(payoutJournal).toMatch(
      /NEW\.status = 'failed'[\s\S]*reverse_posted_journal/,
    );
    expect(payoutJournal).toMatch(
      /NEW\.status = 'succeeded'[\s\S]*PAYOUT_SUCCEEDED[\s\S]*settlement_in_transit[\s\S]*cash_at_bank/,
    );
    expect(settlementProcessor.indexOf('"claim_seller_payout"')).toBeLessThan(
      settlementProcessor.indexOf('const transfer = await createRouteTransfer'),
    );
  });

  it('fingerprints the complete ledger payload and freezes posted rows and entries', () => {
    const postJournal = section(
      hardening,
      'CREATE OR REPLACE FUNCTION finance.post_journal',
      'REVOKE ALL ON ALL TABLES IN SCHEMA finance',
    );
    for (const field of [
      "'event_type'",
      "'reference_type'",
      "'reference_id'",
      "'entries'",
      "'description'",
      "'metadata'",
      "'effective_at'",
      "'reverses_transaction_id'",
    ]) {
      expect(postJournal).toContain(field);
    }
    expect(postJournal).toMatch(
      /extensions\.digest\(convert_to\(v_payload::text, 'UTF8'\), 'sha256'\)/,
    );
    expect(postJournal.match(/idempotency key payload mismatch/g)).toHaveLength(2);
    expect(postJournal).toMatch(/SET posted_at = now\(\)/);

    expect(hardening).toMatch(
      /CREATE TRIGGER trg_guard_posted_ledger_entry[\s\S]*BEFORE INSERT OR UPDATE OR DELETE ON finance\.ledger_entries/,
    );
    expect(hardening).toMatch(
      /CREATE TRIGGER trg_guard_posted_ledger_transaction[\s\S]*BEFORE UPDATE OR DELETE ON finance\.ledger_transactions/,
    );
    expect(hardening.match(/posted financial journals are immutable/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('reports actual external mismatch counters and fails clean only when all are zero', () => {
    const reconcile = section(
      externalReconciliation,
      'CREATE OR REPLACE FUNCTION finance.reconcile_external_statements',
      'CREATE OR REPLACE FUNCTION public.reconcile_external_statements',
    );
    expect(reconcile).toMatch(
      /SELECT count\(\*\) INTO v_provider_mismatches[\s\S]*reference_type LIKE 'provider_%'[\s\S]*status IN \('open', 'investigating'\)/,
    );
    expect(reconcile).toMatch(
      /SELECT count\(\*\) INTO v_bank_mismatches[\s\S]*m\.id IS NULL/,
    );
    expect(reconcile).toMatch(
      /SELECT count\(\*\) INTO v_unmatched_internal[\s\S]*ps\.id IS NULL/,
    );
    expect(reconcile).toMatch(
      /'clean', v_provider_mismatches = 0[\s\S]*v_bank_mismatches = 0[\s\S]*v_unmatched_internal = 0/,
    );
    expect(reconcileWorker).toMatch(
      /\.select\("id", \{ count: "exact", head: true \}\)[\s\S]*\.in\("status", \["open", "investigating"\]\)/,
    );
    expect(reconcileWorker).toMatch(/status: openCount && openCount > 0 \? 409 : 200/);
  });

  it('atomically claims and snapshots a refund before external money movement', () => {
    const claim = section(
      refundBoundaries,
      'CREATE OR REPLACE FUNCTION public.claim_refund_attempt',
      'REVOKE ALL ON FUNCTION public.claim_refund_attempt',
    );
    expect(claim).toMatch(/FROM public\.refund_requests[\s\S]*FOR UPDATE/);
    expect(claim).toMatch(/FROM public\.orders[\s\S]*FOR UPDATE/);
    expect(claim).toMatch(/FROM public\.seller_settlements[\s\S]*FOR UPDATE/);
    expect(claim).toMatch(
      /INSERT INTO public\.refund_allocation_snapshots[\s\S]*INSERT INTO public\.refund_attempts[\s\S]*UPDATE public\.refund_requests/,
    );
    expect(claim).toMatch(/refund idempotency key payload mismatch/);
    expect(claim).toMatch(/p_amount_minor <> round\(COALESCE\(v_expected, 0\) \* 100\)/);

    const claimCall = refundProcessor.indexOf('"claim_refund_attempt"');
    const providerCall = refundProcessor.indexOf('const gw = await callRazorpayRefund');
    expect(claimCall).toBeGreaterThan(0);
    expect(providerCall).toBeGreaterThan(claimCall);
  });

  it('creates post-payout seller liability and blocks later payouts', () => {
    const liability = section(
      refundBoundaries,
      'CREATE OR REPLACE FUNCTION finance.record_completed_refund_liability',
      'DROP TRIGGER IF EXISTS trg_record_completed_refund_liability',
    );
    expect(liability).toMatch(
      /settlement_status <> 'settled'[\s\S]*RETURN NEW/,
    );
    expect(liability).toMatch(
      /completed post-payout refund lacks allocation snapshot/,
    );
    expect(liability).toMatch(
      /INSERT INTO public\.seller_liability_entries[\s\S]*'post_payout_refund'[\s\S]*seller-refund-liability:/,
    );
    expect(liability).toMatch(
      /SELLER_POST_PAYOUT_LIABILITY[\s\S]*seller_liability_receivable[\s\S]*refund_payable/,
    );
    expect(refundBoundaries).toMatch(
      /liability_minor[\s\S]*> 0 THEN[\s\S]*payout blocked: seller liability requires controlled offset/,
    );
  });

  it('allocates grouped chargebacks proportionally with an exact final remainder', () => {
    const chargeback = section(
      refundBoundaries,
      'CREATE OR REPLACE FUNCTION public.record_provider_chargeback',
      'REVOKE ALL ON FUNCTION public.record_provider_chargeback',
    );
    expect(chargeback).toMatch(/p_amount_minor > v_capture\.amount_minor/);
    expect(chargeback).toMatch(/chargeback capture has no child allocations/);
    expect(chargeback).toMatch(
      /WHEN v_index = v_count THEN p_amount_minor - v_allocated[\s\S]*ELSE floor\([\s\S]*p_amount_minor::numeric[\s\S]*v_allocation\.amount_minor::numeric[\s\S]*v_capture\.amount_minor::numeric/,
    );
    expect(chargeback).toMatch(
      /INSERT INTO public\.chargeback_allocations[\s\S]*INSERT INTO public\.seller_liability_entries/,
    );
    expect(chargeback).toMatch(/seller-chargeback-liability:/);

    const allocate = (captureParts: number[], disputed: number) => {
      let allocated = 0;
      return captureParts.map((part, index) => {
        const amount = index === captureParts.length - 1
          ? disputed - allocated
          : Math.floor((disputed * part) / captureParts.reduce((sum, value) => sum + value, 0));
        allocated += amount;
        return amount;
      });
    };
    const allocations = allocate([10_001, 5_000, 2_999], 7_777);
    expect(allocations.reduce((sum, value) => sum + value, 0)).toBe(7_777);
    expect(allocations).toEqual([4_320, 2_160, 1_297]);
  });

  it('keeps wallet UX capability-aware with no client arithmetic fallback', () => {
    expect(walletHook).toMatch(/supabase\.rpc\('get_financial_capabilities'\)/);
    expect(walletHook).toMatch(
      /const spendEnabled = capabilities\?\.wallet_spend_enabled === true/,
    );
    const refreshQuote = section(
      walletHook,
      'const refreshQuote = useCallback',
      'const clearApplied = useCallback',
    );
    expect(refreshQuote).toMatch(
      /if \(!spendEnabled\)[\s\S]*setQuotedMax\(0\)[\s\S]*setAppliedAmount\(0\)[\s\S]*return 0/,
    );
    expect(refreshQuote).toMatch(
      /catch \(err\)[\s\S]*setQuotedMax\(0\)[\s\S]*setAppliedAmount\(0\)[\s\S]*return 0/,
    );
    expect(refreshQuote).not.toMatch(/cashAvailable|promoAvailable|balance/);
    expect(walletHook).not.toMatch(/Math\.min\([^)]*(cashAvailable|promoAvailable|balance)/);

    const toggle = section(
      walletHook,
      'const toggleCredit = useCallback',
      'const releaseForOrders = useCallback',
    );
    expect(toggle.indexOf('if (!spendEnabled)')).toBeLessThan(
      toggle.indexOf('await refreshQuote'),
    );
    expect(toggle).toMatch(/spending is temporarily unavailable/);
  });
});
