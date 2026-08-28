import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buyerDisputeCopy,
  normalizeSocivaBalanceRefundEligibility,
  sellerRefundUnavailableCopy,
} from '@/lib/sociva-balance-refund-eligibility';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('payment-mode refund eligibility migration', () => {
  const migration = read('supabase/migrations/20260828250000_payment_mode_refund_eligibility.sql');

  it('defines central eligibility RPC from payment gateway mode', () => {
    expect(migration).toMatch(/get_sociva_balance_refund_eligibility/);
    expect(migration).toMatch(/is_online_payment_platform_enabled/);
    expect(migration).toMatch(/get_public_payment_mode\(\) <> 'off'/);
    expect(migration).toMatch(/is_order_online_payment_source/);
  });

  it('blocks wallet refund credit when platform offline or COD', () => {
    expect(migration).toMatch(/PLATFORM_ONLINE_DISABLED/);
    expect(migration).toMatch(/COD_PAYMENT_NOT_SUPPORTED_FOR_SOCIVA_BALANCE_REFUND/);
    expect(migration).toMatch(/complete_wallet_refund/);
    expect(migration).toMatch(/seller_respond_refund/);
  });

  it('rejects COD + wallet at checkout apply', () => {
    expect(migration).toMatch(/wallet_not_eligible_for_cod/);
    expect(migration).not.toMatch(/IN \('cod', 'wallet'\)/);
  });

  it('extends financial capabilities with derived gates', () => {
    expect(migration).toMatch(/sociva_balance_refund_enabled/);
    expect(migration).toMatch(/sociva_balance_spend_enabled/);
    expect(migration).toMatch(/seller_payout_enabled/);
  });

  it('adds funding_party and seller_resolution destination', () => {
    expect(migration).toMatch(/funding_party/);
    expect(migration).toMatch(/seller_resolution/);
    expect(migration).toMatch(/SELLER_FUNDED/);
  });
});

describe('sociva balance refund eligibility helpers', () => {
  it('normalizes RPC payload', () => {
    const elig = normalizeSocivaBalanceRefundEligibility({
      eligible: false,
      reason: 'PLATFORM_ONLINE_DISABLED',
      message: 'Online payment refunds are unavailable.',
      payment_gateway_mode: 'off',
      payment_method: 'cod',
    });
    expect(elig?.eligible).toBe(false);
    expect(elig?.reason).toBe('PLATFORM_ONLINE_DISABLED');
  });

  it('buyer copy avoids balance promise when ineligible', () => {
    const copy = buyerDisputeCopy(false);
    expect(copy.body).not.toMatch(/Sociva Balance if approved/i);
    expect(copy.body).toMatch(/seller/i);
  });

  it('seller unavailable copy explains COD vs platform off', () => {
    expect(
      sellerRefundUnavailableCopy({
        eligible: false,
        reason: 'PLATFORM_ONLINE_DISABLED',
        message: '',
      }),
    ).toMatch(/chat or call/i);

    expect(
      sellerRefundUnavailableCopy({
        eligible: false,
        reason: 'COD_PAYMENT_NOT_SUPPORTED_FOR_SOCIVA_BALANCE_REFUND',
        message: '',
      }),
    ).toMatch(/Cash on Delivery/i);
  });
});

describe('payment-mode refund UI wiring', () => {
  const sellerActions = read('src/components/refund/SellerRefundActions.tsx');
  const refundCard = read('src/components/refund/RefundRequestCard.tsx');
  const cartPage = read('src/pages/CartPage.tsx');
  const cartHook = read('src/hooks/useCartPage.ts');

  it('seller hides approve buttons when balance refund ineligible', () => {
    expect(sellerActions).toMatch(/get_sociva_balance_refund_eligibility/);
    expect(sellerActions).toMatch(/canIssueBalanceRefund/);
    expect(sellerActions).toMatch(/sellerRefundUnavailableCopy/);
  });

  it('buyer refund card is payment-mode aware', () => {
    expect(refundCard).toMatch(/buyerDisputeCopy/);
    expect(refundCard).not.toMatch(/p_refund_destination: 'wallet'/);
  });

  it('cart blocks wallet on COD and platform off', () => {
    expect(cartPage).toMatch(/paymentMethod !== 'cod'/);
    expect(cartHook).toMatch(/wallet\.clearApplied/);
    expect(cartHook).toMatch(/paymentMode\.isOff/);
  });
});
