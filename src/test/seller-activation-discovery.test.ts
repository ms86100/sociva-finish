import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickNotificationRoute } from '@/lib/notification-routes';
import { hasPreciseCoordinates } from '@/lib/buyerLocation';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('seller activation, discovery, and location', () => {
  it('routes store-approved notifications to Sociva Credits', () => {
    expect(pickNotificationRoute({ type: 'seller_approved' })).toBe('/seller/credits');
    expect(pickNotificationRoute({
      type: 'seller_approved',
      reference_path: '/seller/credits',
    })).toBe('/seller/credits');
  });

  it('enqueues store approval through the existing notification queue', () => {
    const sql = read('supabase/migrations/20260822100000_seller_activation_discovery_notifications.sql');
    const notify = read('src/lib/admin-notifications.ts');
    expect(sql).toMatch(/enqueue_seller_lifecycle_notification/);
    expect(sql).toMatch(/Your store is now live!|Your store has been approved!/);
    expect(sql).toMatch(/\/seller\/credits/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, idempotency_key\)/);
    expect(sql).toMatch(/trg_enqueue_seller_status_notification/);
    expect(notify).toMatch(/enqueue_seller_lifecycle_notification/);
    expect(notify).toMatch(/export async function notifySellerStatusChange[\s\S]*enqueue_seller_lifecycle_notification/);
  });

  it('requires credit activation regardless of spend kill-switch', () => {
    const helpers = read('supabase/migrations/20260822100000_seller_activation_discovery_notifications.sql');
    const alwaysGated = read('supabase/migrations/20260823100000_seller_credit_discovery_always_gated.sql');
    const rpcs = read('supabase/migrations/20260822101000_seller_discovery_eligibility_rpcs.sql');
    expect(helpers).toMatch(/seller_credit_activation_satisfied/);
    expect(helpers).toMatch(/seller_is_eligible_for_discovery/);
    expect(helpers).toMatch(/delivery_radius_km, 0\) <= 0/);
    expect(helpers).toMatch(/seller_is_discoverable_to_buyer/);
    expect(helpers).toMatch(/trg_orders_enforce_seller_eligibility/);
    expect(alwaysGated).toMatch(/seller_credit_activation_satisfied/);
    expect(alwaysGated).not.toMatch(/seller_credit_spend_active\(\)/);
    expect(alwaysGated).toMatch(/Anyone can view available products from approved sellers/);
    expect(rpcs).toMatch(/search_products_v2/);
    expect(rpcs).toMatch(/search_products_fts/);
    expect(rpcs).toMatch(/search_sellers_paginated/);
    expect(rpcs).toMatch(/get_products_for_sellers/);
    expect(rpcs).toMatch(/seller_is_discoverable_to_buyer\(sp\.id, _lat, _lng\)/);
    expect(rpcs).not.toMatch(/COALESCE\(sp\.delivery_radius_km, i\.radius_km\)/);
    const remaining = read('supabase/migrations/20260822105000_gate_remaining_discovery_rpcs.sql');
    expect(remaining).toMatch(/get_user_frequent_products/);
    expect(remaining).toMatch(/search_nearby_sellers/);
    expect(remaining).toMatch(/seller_is_eligible_for_discovery\(p\.seller_id\)/);
    expect(remaining).toMatch(/seller_is_eligible_for_discovery\(sp\.id\)/);
    expect(remaining).not.toMatch(/COALESCE\(sp\.delivery_radius_km, 5\)/);
    const dropUngated = read('supabase/migrations/20260822102000_drop_ungated_get_products_for_sellers.sql');
    expect(dropUngated).toMatch(/DROP FUNCTION IF EXISTS public\.get_products_for_sellers\(uuid\[\], text, integer, integer\)/);
  });

  it('rejects missing or zeroed coordinates', () => {
    expect(hasPreciseCoordinates(12.97, 77.59)).toBe(true);
    expect(hasPreciseCoordinates(null, 77.59)).toBe(false);
    expect(hasPreciseCoordinates('12.97', '77.59')).toBe(true);
    expect(hasPreciseCoordinates(0, 0)).toBe(false);
    expect(hasPreciseCoordinates(91, 77)).toBe(false);
  });

  it('keeps recharge presets, custom minimum, and server verification in the credits UI', () => {
    const page = read('src/pages/SellerCreditsPage.tsx');
    const orderFn = read('supabase/functions/create-seller-credit-order/index.ts');
    const confirmFn = read('supabase/functions/confirm-seller-credit-payment/index.ts');
    const dashboard = read('src/pages/SellerDashboardPage.tsx');
    expect(page).toMatch(/Recharge Sociva Credits/);
    expect(page).toMatch(/Minimum recharge amount is ₹\$\{MIN_RECHARGE\}/);
    expect(page).toMatch(/confirm-seller-credit-payment/);
    expect(page).toMatch(/Recharge Successful/);
    expect(page).toMatch(/Recharge could not be completed/);
    expect(page).toMatch(/Payment cancelled/);
    expect(page).toMatch(/selectPreset/);
    expect(orderFn).toMatch(/create_seller_credit_purchase_amount/);
    expect(orderFn).toMatch(/Minimum recharge amount is ₹100/);
    expect(confirmFn).toMatch(/confirm_seller_credit_purchase/);
    expect(confirmFn).toMatch(/pending: true/);
    expect(dashboard).toMatch(/SellerJourneyBanner/);
    expect(dashboard).toMatch(/stack-gap-lg|flex flex-col gap-4/);
    expect(dashboard).toMatch(/creditActivated/);
    expect(read('src/pages/HomePage.tsx')).toMatch(/SellerJourneyBanner/);
    expect(read('src/pages/HomePage.tsx')).toMatch(/stack-gap/);
  });

  it('gates seller pages, reorder, enquiry, and booking through the same eligibility RPC', () => {
    const sellerPage = read('src/pages/SellerDetailPage.tsx');
    const reorder = read('src/components/home/ReorderLastOrder.tsx');
    const enquiry = read('src/components/product/ProductEnquirySheet.tsx');
    const booking = read('src/components/booking/ServiceBookingFlow.tsx');
    expect(sellerPage).toMatch(/buyerCanOrderFromSeller/);
    expect(sellerPage).toMatch(/PreciseLocationRequiredCard/);
    expect(reorder).toMatch(/filterDiscoverableProductIds/);
    expect(enquiry).toMatch(/buyerCanOrderFromSeller/);
    expect(enquiry).toMatch(/ProductExtraPicker/);
    expect(enquiry).toMatch(/p_selected_extras/);
    expect(booking).toMatch(/buyerCanOrderFromSeller/);
    expect(booking).toMatch(/ProductExtraPicker/);
    expect(booking).toMatch(/_selected_extras/);
  });

  it('revalidates eligibility on payment_pending insert and placed update', () => {
    const sql = read('supabase/migrations/20260822103000_order_eligibility_payment_bind.sql');
    expect(sql).toMatch(/assert_order_seller_eligibility/);
    expect(sql).toMatch(/trg_orders_enforce_seller_eligibility_on_place/);
    expect(sql).toMatch(/BEFORE UPDATE OF status ON public.orders/);
    expect(sql).not.toMatch(/IF NEW.status IN \('cancelled', 'payment_pending'\)/);
    expect(sql).toMatch(/buyer_coordinates_are_valid/);
    expect(sql).toMatch(/seller_is_discoverable_to_buyer/);
    expect(sql).toMatch(/_seller_radius is null or _seller_radius <= 0/);
    expect(sql).toMatch(/error', 'buyer_location'/);
    expect(sql).toMatch(/error', 'credit_blocked'/);
    expect(sql).toMatch(/seller_credit_activation_satisfied/);
  });

  it('binds Razorpay payments to a specific credit purchase', () => {
    const sql = read('supabase/migrations/20260822103000_order_eligibility_payment_bind.sql');
    const confirm = read('supabase/functions/confirm-seller-credit-payment/index.ts');
    const webhook = read('supabase/functions/razorpay-webhook/index.ts');
    const page = read('src/pages/SellerCreditsPage.tsx');
    expect(sql).toMatch(/payment already applied to another purchase/);
    expect(sql).toMatch(/credit purchase order mismatch/);
    expect(sql).toMatch(/idx_seller_credit_ledger_purchase_once/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public.confirm_seller_credit_purchase/);
    expect(confirm).toMatch(/verifyRazorpayCheckoutSignature/);
    expect(confirm).toMatch(/seller_credit_purchase/);
    expect(confirm).toMatch(/No credit purchase is bound to this payment order/);
    expect(confirm).toMatch(/source !== "webhook"/);
    expect(webhook).toMatch(/verifyRazorpaySignature\(body, signature, webhookSecret\)/);
    expect(webhook).toMatch(/sellerCreditCaptured/);
    expect(webhook.indexOf('verifyRazorpaySignature')).toBeLessThan(webhook.indexOf('checkFinancialRuntime'));
    expect(page).toMatch(/razorpay_signature: response.razorpay_signature/);
  });

  it('closes favorites, highlights, and secondary discovery leaks', () => {
    expect(read('src/pages/FavoritesPage.tsx')).toMatch(/filterDiscoverableSellerIds/);
    expect(read('src/hooks/useProductFavorites.ts')).toMatch(/filterDiscoverableProductIds/);
    expect(read('src/components/home/AutoHighlightStrip.tsx')).toMatch(/filterDiscoverableSellerIds/);
    expect(read('src/components/home/SocietyLeaderboard.tsx')).toMatch(/filterDiscoverableSellerIds/);
    expect(read('src/components/search/SearchAutocomplete.tsx')).toMatch(/filterDiscoverableSellerIds/);
    expect(read('src/lib/sellerDiscoverability.ts')).toMatch(/filter_discoverable_seller_ids/);
    expect(read('src/lib/buyerLocation.ts')).toMatch(/Precise location required/);
    expect(read('src/lib/buyerLocation.ts')).toMatch(/does not have a precise map location/);
    expect(read('src/components/home/BuyAgainRow.tsx')).toMatch(/filterDiscoverableProductIds/);
    expect(read('src/hooks/useProductDetail.ts')).toMatch(/filterDiscoverableProductIds/);
  });

  it('includes an isolated live proof for approval, eligibility, and payment bind', () => {
    const sql = read('supabase/migrations/20260822104000_golive_isolated_proof.sql');
    expect(sql).toMatch(/seller_credit_run_golive_proof/);
    expect(sql).toMatch(/approval_queues_store_live/);
    expect(sql).toMatch(/credit_500_once/);
    expect(sql).toMatch(/duplicate_payment_idempotent/);
    expect(sql).toMatch(/foreign_payment_rejected/);
    expect(sql).toMatch(/wrong_amount_rejected/);
    expect(sql).toMatch(/place_rejects_no_credit/);
    expect(sql).toMatch(/insert_rejects_no_credit/);
    expect(sql).toMatch(/cert_isolated_proof_no_live_push/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.seller_credit_run_golive_proof\(\) TO service_role/);
  });

  it('defaults new profiles to browse beyond community', () => {
    const sql = read('supabase/migrations/20260829070605_profiles_browse_beyond_default_on.sql');
    expect(sql).toMatch(/ALTER COLUMN browse_beyond_community SET DEFAULT true/);
    expect(sql).toMatch(/NEW\.browse_beyond_community := true/);
    expect(sql).toMatch(/trg_profiles_browse_beyond_on_insert/);
    expect(sql).toMatch(/browse_beyond_community\)\s*VALUES \([\s\S]*true/);
    const otp = read('supabase/functions/msg91-verify-otp/index.ts');
    expect(otp).toMatch(/browse_beyond_community:\s*true/);
  });
});
