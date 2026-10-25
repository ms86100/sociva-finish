import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { shouldApplyReadTimeout } from '@/lib/network-timeout';
import {
  SELLER_MANUAL_COMPLETE_COPY,
  SELLER_MANUAL_COMPLETE_RPC,
  isSellerManualCompleteEligible,
  mapSellerManualCompleteError,
  sellerManualCompleteButtonLabel,
  shouldShowManualCompleteSuccess,
} from '@/lib/seller-manual-complete';
import {
  createAuthenticatedClient,
  createTestClient,
  trySeedTestUsers,
} from './helpers/integration';
import { hasSupabaseEnv } from './helpers/supabase-env';

const MIGRATION = resolve(
  __dirname,
  '../../supabase/migrations/20261021220000_seller_complete_order_without_otp.sql',
);
const OTP_LOCKOUT = resolve(
  __dirname,
  '../../supabase/migrations/20260923220000_delivery_otp_attempt_lockout.sql',
);
const GENERIC_OTP = resolve(
  __dirname,
  '../../supabase/migrations/20260411094842_ec66855e-44a3-4f6a-92c4-d52fef3305a4.sql',
);
const OTP_GATE = resolve(
  __dirname,
  '../../supabase/migrations/20260411084929_3dc62488-46ea-4428-bb6c-8af703700633.sql',
);
const DETAIL_PAGE = resolve(__dirname, '../pages/OrderDetailPage.tsx');
const DIALOG = resolve(__dirname, '../components/order/SellerManualCompleteDialog.tsx');
const HOOK = resolve(__dirname, '../hooks/useOrderDetail.ts');
const OTP_DIALOG = resolve(__dirname, '../components/delivery/DeliveryCompletionOtpDialog.tsx');

const migration = readFileSync(MIGRATION, 'utf8');
const page = readFileSync(DETAIL_PAGE, 'utf8');
const dialog = readFileSync(DIALOG, 'utf8');
const hook = readFileSync(HOOK, 'utf8');
const otpDialog = readFileSync(OTP_DIALOG, 'utf8');
const otpRpc = readFileSync(OTP_LOCKOUT, 'utf8');
const genericRpc = readFileSync(GENERIC_OTP, 'utf8');
const otpGate = readFileSync(OTP_GATE, 'utf8');

await trySeedTestUsers();
const describeDb = hasSupabaseEnv ? describe : describe.skip;

describe('seller OTP-free completion helpers', () => {
  it('shows the option only when an OTP CTA would already appear', () => {
    expect(isSellerManualCompleteEligible('delivery', true)).toBe(true);
    expect(isSellerManualCompleteEligible('delivery', false)).toBe(false);
    expect(isSellerManualCompleteEligible('generic', false)).toBe(true);
    expect(isSellerManualCompleteEligible(null, true)).toBe(false);
    expect(sellerManualCompleteButtonLabel('delivery')).toBe(SELLER_MANUAL_COMPLETE_COPY.deliveryButton);
    expect(sellerManualCompleteButtonLabel('generic')).toBe(SELLER_MANUAL_COMPLETE_COPY.pickupButton);
  });

  it('maps unauthorized, cancelled, scheduled, session, and network errors', () => {
    expect(mapSellerManualCompleteError('Not authorized').kind).toBe('unauthorized');
    expect(mapSellerManualCompleteError('A cancelled or closed order cannot be completed').kind).toBe('cancelled');
    expect(mapSellerManualCompleteError('A refunded order cannot be completed').kind).toBe('refunded');
    expect(mapSellerManualCompleteError('Scheduled fulfillment is not open yet. This order cannot be completed until the preparation window starts.').kind).toBe('scheduled');
    expect(mapSellerManualCompleteError('JWT expired').kind).toBe('session');
    expect(mapSellerManualCompleteError('Authentication required').kind).toBe('session');
    expect(mapSellerManualCompleteError('Failed to fetch').kind).toBe('network');
    expect(mapSellerManualCompleteError('This order is not eligible for completion without OTP').kind).toBe('invalid_state');
  });

  it('does not treat a network failure as successful completion', () => {
    expect(shouldShowManualCompleteSuccess(false, false)).toBe(false);
    expect(shouldShowManualCompleteSuccess(true, true)).toBe(false);
    expect(shouldShowManualCompleteSuccess(true, false)).toBe(true);
  });
});

describe('seller OTP-free completion source contract', () => {
  it('covers instant, scheduled, and pre-order on one RPC (no type gate; scheduled uses prep window)', () => {
    // Instant / pre-order / scheduled share the same path. Only scheduled rows
    // with a future preparation_start_at are blocked until the window opens.
    expect(migration).toMatch(/IF _order\.scheduled_date IS NOT NULL THEN/);
    expect(migration).toMatch(/preparation_start_at/);
    expect(migration).toMatch(/Scheduled fulfillment is not open yet/);
    expect(migration).not.toMatch(/IF _order\.order_type/);
    expect(migration).not.toMatch(/IF _order\.fulfillment_type/);
    expect(migration).not.toMatch(/accepts_preorders/);
    expect(page).toMatch(/isSellerManualCompleteEligible\(nextOtpType/);
    expect(page).toMatch(/seller_complete_order_without_otp|completeOrderWithoutOtp/);
  });

  it('adds a dedicated seller RPC without changing OTP verify functions', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.seller_complete_order_without_otp/);
    expect(migration).toMatch(/FOR UPDATE OF o/);
    expect(migration).toMatch(/Authentication required/);
    expect(migration).toMatch(/Not authorized/);
    expect(migration).toMatch(/seller_manual/);
    expect(migration).toMatch(/completion_method/);
    expect(migration).toMatch(/Scheduled fulfillment is not open yet/);
    expect(migration).not.toMatch(/fulfillment_type = /);
    expect(migration).not.toMatch(/order_type = /);
    expect(otpRpc).toMatch(/_delivery_code/);
    expect(otpRpc).toMatch(/Invalid delivery code/);
    expect(genericRpc).toMatch(/Invalid OTP code/);
    expect(genericRpc).toMatch(/_otp_code/);
    expect(otpGate).toMatch(/Delivery OTP verification required/);
    expect(otpGate).toMatch(/verify_generic_otp_and_advance/);
  });

  it('keeps the existing OTP dialog on the verify path', () => {
    expect(otpDialog).toMatch(/verify_delivery_otp_and_complete/);
    expect(otpDialog).toMatch(/_delivery_code: otp\.trim\(\)/);
    expect(otpDialog).not.toMatch(/seller_complete_order_without_otp/);
    expect(page).toMatch(/verify_delivery_otp_and_complete/);
    expect(page).toMatch(/setIsOtpDialogOpen\(true\)/);
  });

  it('exposes both OTP and OTP-free actions, and only confirms after an explicit confirm', () => {
    expect(page).toMatch(/sellerManualCompleteButtonLabel\(nextOtpType\)/);
    expect(page).toMatch(/SellerManualCompleteDialog/);
    expect(page).toMatch(/setIsManualCompleteOpen\(true\)/);
    expect(page).toMatch(/showManualComplete/);
    expect(page).not.toMatch(/onOpenChange=\{setIsManualCompleteOpen\}[\s\S]{0,80}o\.completeOrderWithoutOtp\(\)/);
    expect(dialog).toMatch(/SELLER_MANUAL_COMPLETE_COPY\.title/);
    expect(dialog).toMatch(/SELLER_MANUAL_COMPLETE_COPY\.body/);
    expect(dialog).toMatch(/SELLER_MANUAL_COMPLETE_COPY\.cancel/);
    expect(dialog).toMatch(/SELLER_MANUAL_COMPLETE_COPY\.confirm/);
    expect(SELLER_MANUAL_COMPLETE_COPY.title).toBe('Confirm order completion');
    expect(SELLER_MANUAL_COMPLETE_COPY.body).toMatch(/without OTP verification/);
    expect(SELLER_MANUAL_COMPLETE_COPY.cancel).toBe('Cancel');
    expect(SELLER_MANUAL_COMPLETE_COPY.confirm).toBe('Confirm Delivery');
    expect(dialog).toMatch(/if \(isSubmitting \|\| success\) return/);
    expect(dialog).toMatch(/disabled=\{isSubmitting\}/);
    expect(dialog).toMatch(/onConfirm/);
    expect(hook).toMatch(/seller_complete_order_without_otp/);
    expect(hook).toMatch(/already_complete/);
    expect(hook).toMatch(/showFeedback/);
  });

  it('does not apply a read timeout to the write RPC', () => {
    expect(
      shouldApplyReadTimeout('https://example.supabase.co/rest/v1/rpc/seller_complete_order_without_otp', {
        method: 'POST',
      }),
    ).toBe(false);
    expect(SELLER_MANUAL_COMPLETE_RPC).toBe('seller_complete_order_without_otp');
  });
});

describeDb('seller OTP-free completion live RPC', () => {
  const missingId = '00000000-0000-4000-8000-000000000001';

  async function sellerClient() {
    try {
      return await createAuthenticatedClient('seller');
    } catch (err) {
      console.warn('[integration] seller sign-in unavailable', (err as Error).message);
      return null;
    }
  }

  async function buyerClient() {
    try {
      return await createAuthenticatedClient('buyer');
    } catch (err) {
      console.warn('[integration] buyer sign-in unavailable', (err as Error).message);
      return null;
    }
  }

  it('rejects an unauthenticated request', async () => {
    const client = createTestClient();
    const { error } = await client.rpc(SELLER_MANUAL_COMPLETE_RPC, { _order_id: missingId });
    expect(error).toBeTruthy();
    const mapped = mapSellerManualCompleteError(error?.message);
    expect(['session', 'unauthorized', 'generic', 'invalid_state']).toContain(mapped.kind);
  });

  it('rejects a buyer completing another seller order', async () => {
    const buyer = await buyerClient();
    if (!buyer) return;
    const { error } = await buyer.rpc(SELLER_MANUAL_COMPLETE_RPC, { _order_id: missingId });
    expect(error).toBeTruthy();
    expect(error?.message || '').toMatch(/not found|not authorized|authentication required/i);
  });

  it('rejects another seller completing an order they do not own', async () => {
    const seller = await sellerClient();
    if (!seller) return;
    const { error } = await seller.rpc(SELLER_MANUAL_COMPLETE_RPC, { _order_id: missingId });
    expect(error).toBeTruthy();
    expect(error?.message || '').toMatch(/not found|not authorized/i);
  });

  it('does not complete a cancelled order when one exists for the seeded seller', async () => {
    const seller = await sellerClient();
    if (!seller) return;
    const { data: profile } = await seller.from('seller_profiles').select('id').limit(1).maybeSingle();
    if (!profile?.id) return;
    const { data: cancelled } = await seller
      .from('orders')
      .select('id, status')
      .eq('seller_id', profile.id)
      .eq('status', 'cancelled')
      .limit(1)
      .maybeSingle();
    if (!cancelled?.id) return;
    const { error } = await seller.rpc(SELLER_MANUAL_COMPLETE_RPC, { _order_id: cancelled.id });
    expect(error).toBeTruthy();
    expect(mapSellerManualCompleteError(error?.message).kind).toBe('cancelled');
  });

  it('returns already_complete without repeating side effects on a delivered order', async () => {
    const seller = await sellerClient();
    if (!seller) return;
    const { data: profile } = await seller.from('seller_profiles').select('id').limit(1).maybeSingle();
    if (!profile?.id) return;
    const { data: delivered } = await seller
      .from('orders')
      .select('id, status, completion_method')
      .eq('seller_id', profile.id)
      .in('status', ['delivered', 'completed', 'buyer_received'])
      .limit(1)
      .maybeSingle();
    if (!delivered?.id) return;
    const { data, error } = await seller.rpc(SELLER_MANUAL_COMPLETE_RPC, { _order_id: delivered.id });
    expect(error).toBeFalsy();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.already_complete).toBe(true);
    expect(row?.new_status).toBe(delivered.status);
  });
});
