import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(__dirname, '../..', relativePath), 'utf8');

describe('wallet financial hardening', () => {
  const migration = readRepoFile(
    'supabase/migrations/20260808055445_wallet_financial_hardening.sql',
  );
  const paymentTruth = readRepoFile(
    'supabase/migrations/20260808131000_attempt_aware_payment_truth.sql',
  );
  const createOrder = readRepoFile(
    'supabase/functions/create-razorpay-order/index.ts',
  );
  const confirmPayment = readRepoFile(
    'supabase/functions/confirm-razorpay-payment/index.ts',
  );
  const autoCancel = readRepoFile(
    'supabase/functions/auto-cancel-orders/index.ts',
  );
  const webhook = readRepoFile(
    'supabase/functions/razorpay-webhook/index.ts',
  );
  const refundProcessor = readRepoFile(
    'supabase/functions/refund-processor/index.ts',
  );
  const settlementProcessor = readRepoFile(
    'supabase/functions/process-settlements/index.ts',
  );

  it('never attaches an eager Route transfer during payment-order creation', () => {
    expect(createOrder).not.toMatch(/orderPayload\.transfers/);
    expect(createOrder).toMatch(/platform_collect:\s*'1'/);
  });

  it('recognizes only captured Razorpay payments as paid', () => {
    expect(confirmPayment).toMatch(/paymentEntity\.status !== "captured"/);
    expect(confirmPayment).not.toMatch(
      /paymentEntity\.status !== "captured"\s*&&\s*paymentEntity\.status !== "authorized"/,
    );
    expect(confirmPayment).toMatch(/reconciliation_required/);
  });

  it('models one provider capture with child-order allocations', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_captures/);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.payment_capture_allocations/,
    );
    expect(confirmPayment).toMatch(/confirm_captured_payment_group/);
    expect(paymentTruth).toMatch(/INSERT INTO public\.payment_capture_allocations/);
    expect(migration).toMatch(/capture allocation mismatch/);
  });

  it('enforces balanced immutable journal posting in minor units', () => {
    expect(migration).toMatch(/amount_minor bigint NOT NULL CHECK \(amount_minor > 0\)/);
    expect(migration).toMatch(/v_debits <> v_credits/);
    expect(migration).toMatch(/posted financial journals are immutable/);
    expect(migration).toMatch(/journal is missing required template accounts/);
  });

  it('persists and deduplicates provider events before processing', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.payment_provider_events/);
    expect(migration).toMatch(/UNIQUE \(provider, event_id\)/);
    expect(webhook).toMatch(/payment_provider_events/);
    expect(webhook).toMatch(/deduplicated: true/);
  });

  it('defers auto-cancellation when provider state is unknown', () => {
    expect(autoCancel).toMatch(/Promise<"captured" \| "unpaid" \| "unknown">/);
    expect(autoCancel).toMatch(/payment_reconciliation_required/);
    expect(autoCancel).not.toMatch(/verification failed, proceeding with cancel/);
  });

  it('does not infer a child refund from aggregate refunded amount', () => {
    expect(autoCancel).not.toMatch(/amount_refunded_verified/);
    expect(refundProcessor).toMatch(/exact_refund_reference_required/);
    expect(refundProcessor).toMatch(/missing_original_payment_reference/);
    expect(webhook).toMatch(/unmatched_refund_requires_reconciliation/);
    expect(refundProcessor).toMatch(/insufficient_provider_refundable_amount/);
    expect(refundProcessor).toMatch(/razorpay_refund_missing_provider_id/);
    expect(refundProcessor).toMatch(/state: "refund_processing"/);
  });

  it('records payout and refund attempts before external money movement', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.payout_attempts/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.refund_attempts/);
    expect(refundProcessor).toMatch(/refund_attempts/);
    expect(settlementProcessor).toMatch(/transfer\.state === "unknown"/);
    expect(settlementProcessor).toMatch(/claim_seller_payout/);
    expect(settlementProcessor).toMatch(/finalize_seller_payout/);
    expect(migration).toMatch(/refund cannot start while seller payout is processing/);
    expect(settlementProcessor).toMatch(/razorpay_transfer_non_terminal/);
    expect(webhook).toMatch(/event === 'transfer\.processed'/);
  });

  it('keeps regulated buyer money features disabled by default', () => {
    expect(migration).toMatch(/\('buyer_withdrawal_enabled', false/);
    expect(migration).toMatch(/\('buyer_topup_enabled', false/);
    expect(migration).toMatch(/\('buyer_p2p_enabled', false/);
    expect(migration).toMatch(/'provider_payout_mode',\s*'disabled'/);
    expect(migration).toMatch(/\('wallet_spend_enabled', false/);
  });
});
