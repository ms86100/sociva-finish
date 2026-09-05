import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickNotificationRoute } from '@/lib/notification-routes';
import { SELLER_LIFECYCLE_INBOX_TYPES, SELLER_OPERATIONAL_TYPES } from '@/lib/notification-visibility';
import {
  formatStoreLocationLabel,
  FREE_DELIVERY_NOTICE,
  HOME_SELLER_LOCATION_HINT,
  isSellerDeliveryMode,
  sellingRadiusCopy,
} from '@/lib/seller-onboarding-copy';
import { functionInvokeErrorMessage, parseFunctionInvokeError } from '@/lib/function-invoke-error';
import { isSellerJourneyDuplicateNotification, pickSellerJourneyStore, isShelvedSellerStore, resolveSellerJourney, pickDefaultSellerStoreId, displaySellerStoreName, pickBecomeSellerBlockingStore } from '@/lib/seller-journey';

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('seller onboarding lifecycle', () => {
  it('uses short v5 store submit with location defaults instead of multi-step store setup', () => {
    const page = read('src/pages/BecomeSellerPage.tsx');
    expect(page).toContain('Name your store and submit');
    expect(page).toContain('Store location defaults from your profile/society');
    expect(page).toContain('Submit for review');
    expect(page).toContain('NEW_ONBOARDING_TOTAL_STEPS');
    expect(page).not.toMatch(/📍 Set/);
    expect(page).not.toMatch(/Location set with a pin/);
    const hook = read('src/hooks/useSellerApplication.ts');
    expect(hook).toContain('resolveDefaultStoreLocation');
  });

  it('uses a fixed center location dot instead of a draggable dropped pin', () => {
    const map = read('src/components/auth/GoogleMapConfirm.tsx');
    expect(map).toContain('Move the map to position the location');
    expect(map).toContain('bg-[#1a73e8]');
    expect(map).not.toContain('google.maps.Marker');
    expect(map).not.toContain('Drag the pin or tap the map');
    expect(map).not.toMatch(/draggable:\s*true/);
  });

  it('explains discovery and delivery responsibility from the chosen radius', () => {
    expect(HOME_SELLER_LOCATION_HINT).toMatch(/home address or enter your society/);
    expect(FREE_DELIVERY_NOTICE).toMatch(/cannot charge a separate delivery fee/);
    expect(isSellerDeliveryMode('seller_delivery')).toBe(true);
    expect(isSellerDeliveryMode('self_pickup')).toBe(false);
    expect(sellingRadiusCopy(7, 'seller_delivery')).toMatch(/7 km/);
    expect(sellingRadiusCopy(7, 'seller_delivery')).toMatch(/responsible for delivering/);
    expect(formatStoreLocationLabel('Shriram Greenfield Phase 1')).toBe('Shriram Greenfield Phase 1');
    expect(formatStoreLocationLabel('Location set with a pin', 'Shriram Greenfield Phase 1')).toBe('Shriram Greenfield Phase 1');
  });

  it('keeps store lifecycle events visible in the buyer-mode bell', () => {
    expect(SELLER_LIFECYCLE_INBOX_TYPES).toContain('seller_approved');
    expect(SELLER_LIFECYCLE_INBOX_TYPES).toContain('seller_store_submitted');
    expect(SELLER_OPERATIONAL_TYPES).not.toContain('seller_approved');
    const inbox = read('src/hooks/queries/useNotifications.ts');
    const badge = read('src/hooks/useUnreadNotificationCount.ts');
    expect(inbox).toContain('SELLER_LIFECYCLE_OR_FILTER');
    expect(badge).toContain('SELLER_LIFECYCLE_OR_FILTER');
    expect(pickNotificationRoute({ type: 'seller_store_submitted' })).toBe('/become-seller');
    expect(pickNotificationRoute({ type: 'seller_credit_failed' })).toBe('/seller/credits');
  });

  it('dual-writes submitted and approved notifications into the inbox', () => {
    const sql = read('supabase/migrations/20260822120000_seller_lifecycle_inbox_and_submit.sql');
    expect(sql).toMatch(/seller_store_submitted/);
    expect(sql).toMatch(/INSERT INTO public.user_notifications/);
    expect(sql).toMatch(/verification_status IN \('pending', 'approved', 'rejected', 'suspended'\)/);
    const copy = read('supabase/migrations/20260822140000_seller_journey_notification_copy.sql');
    expect(copy).toMatch(/We''re reviewing your store/);
    expect(copy).toMatch(/Your store is approved/);
    expect(copy).toMatch(/Recharge Sociva Credits/);
    const hook = read('src/hooks/useSellerApplication.ts');
    expect(hook).toMatch(/enqueue_seller_lifecycle_notification/);
    expect(hook).toMatch(/p_status: 'pending'/);
  });

  it('shows a calm home-journey state from review through recharge', () => {
    const pending = resolveSellerJourney([
      { id: 's1', business_name: 'Geeta Store', verification_status: 'pending' },
    ]);
    expect(pending.kind).toBe('pending');
    expect(pending.title).toMatch(/reviewing your store/i);
    expect(pending.body).toMatch(/Seller Dashboard/);
    expect(pending.body).not.toMatch(/Nothing more is needed/);
    expect(pending.href).toBe('/seller');
    expect(pending.cta).toMatch(/Finish store details/);

    const recharge = resolveSellerJourney([
      { id: 's1', business_name: 'Geeta Store', verification_status: 'approved' },
    ], false);
    expect(recharge.kind).toBe('approved_recharge');
    expect(recharge.href).toBe('/seller/credits');
    expect(recharge.cta).toMatch(/Recharge credits/);

    // Unknown/loading credits must not flash "Your store is approved" for live stores
    const rechargeWhileLoading = resolveSellerJourney([
      { id: 's1', business_name: 'Geeta Store', verification_status: 'approved' },
    ], undefined);
    expect(rechargeWhileLoading.kind).toBe('none');

    const live = resolveSellerJourney([
      { id: 's1', business_name: 'Geeta Store', verification_status: 'approved' },
    ], true);
    expect(live.kind).toBe('none');
  });

  it('ignores shelved [ARCHIVED]/ [HOLD] stores so live multi-store sellers are not stuck', () => {
    expect(isShelvedSellerStore({ business_name: '[ARCHIVED] Old Studio' })).toBe(true);
    expect(isShelvedSellerStore({ business_name: '[HOLD] Homestyle' })).toBe(true);
    expect(isShelvedSellerStore({ business_name: 'Biryani and Kebab' })).toBe(false);

    const picked = pickSellerJourneyStore([
      { id: 'arch', business_name: '[ARCHIVED] Dr. Sagar Wellness', verification_status: 'rejected' },
      { id: 'hold', business_name: '[HOLD] Sagar Homestyle Kitchen', verification_status: 'approved' },
      { id: 'live', business_name: 'Biryani and Kebab', verification_status: 'approved' },
    ]);
    expect(picked?.sellerId).toBe('live');
    expect(picked?.status).toBe('approved');

    const journey = resolveSellerJourney([
      { id: 'arch', business_name: '[ARCHIVED] Dr. Sagar Wellness', verification_status: 'rejected' },
      { id: 'live', business_name: 'Biryani and Kebab', verification_status: 'approved' },
    ], true);
    expect(journey.kind).toBe('none');

    const realReject = resolveSellerJourney([
      { id: 'arch', business_name: '[ARCHIVED] Old', verification_status: 'rejected' },
      { id: 'bad', business_name: 'Real Rejected Kitchen', verification_status: 'rejected' },
    ]);
    expect(realReject.kind).toBe('rejected');
    expect(realReject.sellerId).toBe('bad');
    expect(realReject.storeName).toBe('Real Rejected Kitchen');
    expect(realReject.href).toContain('seller=bad');
  });

  it('does not block become-seller on shelved [ARCHIVED] rejects when a live store exists', () => {
    expect(
      pickBecomeSellerBlockingStore([
        { id: 'arch', business_name: '[ARCHIVED] Ramdev Medical', verification_status: 'rejected' },
        { id: 'live', business_name: 'Biryani and Kebab', verification_status: 'approved' },
      ]),
    ).toBeNull();

    expect(
      pickBecomeSellerBlockingStore([
        { id: 'arch', business_name: '[ARCHIVED] Ramdev Medical', verification_status: 'rejected' },
        { id: 'pend', business_name: 'New Cafe', verification_status: 'pending' },
      ])?.id,
    ).toBe('pend');

    expect(
      pickBecomeSellerBlockingStore([
        { id: 'bad', business_name: 'Real Rejected Kitchen', verification_status: 'rejected' },
      ])?.id,
    ).toBe('bad');

    const hook = read('src/hooks/useSellerApplication.ts');
    expect(hook).toContain('pickBecomeSellerBlockingStore');
    expect(hook).toContain('isShelvedSellerStore');
    const page = read('src/pages/BecomeSellerPage.tsx');
    expect(page).toContain('isShelvedSellerStore(existingSeller)');
  });

  it('picks a live approved store as dashboard default instead of [ARCHIVED]', () => {
    expect(
      pickDefaultSellerStoreId([
        { id: 'arch', business_name: '[ARCHIVED] Dr. Sagar Wellness', verification_status: 'rejected' },
        { id: 'live', business_name: 'Biryani and Kebab', verification_status: 'approved' },
      ]),
    ).toBe('live');
    expect(
      pickDefaultSellerStoreId(
        [
          { id: 'arch', business_name: '[ARCHIVED] Old', verification_status: 'rejected' },
          { id: 'live', business_name: 'Biryani and Kebab', verification_status: 'approved' },
        ],
        'arch',
      ),
    ).toBe('live');
    expect(displaySellerStoreName('[HOLD] Sagar Homestyle Kitchen')).toBe('Sagar Homestyle Kitchen');
  });

  it('hides home inbox cards that duplicate the seller journey banner', () => {
    expect(isSellerJourneyDuplicateNotification('pending', 'seller_store_submitted')).toBe(true);
    expect(isSellerJourneyDuplicateNotification('approved_recharge', 'seller_approved')).toBe(true);
    expect(isSellerJourneyDuplicateNotification('rejected', 'seller_rejected')).toBe(true);
    expect(isSellerJourneyDuplicateNotification('none', 'seller_store_submitted', [
      { id: 's1', verification_status: 'approved' },
    ])).toBe(true);
    expect(isSellerJourneyDuplicateNotification('none', 'seller_approved', [
      { id: 's1', verification_status: 'approved' },
    ])).toBe(true);
    expect(isSellerJourneyDuplicateNotification('none', 'order_placed')).toBe(false);
  });

  it('surfaces the real credit recharge error instead of the generic non-2xx wrapper', async () => {
    const message = await functionInvokeErrorMessage({
      error: new Error('Edge Function returned a non-2xx status code'),
      data: { error: "We couldn't start the recharge: authentication failed" },
    });
    expect(message).toMatch(/authentication failed/);
    const pending = await parseFunctionInvokeError({
      error: new Error('Edge Function returned a non-2xx status code'),
      data: { error: 'Payment is still being confirmed. Your Sociva Credits will appear after verification.', pending: true },
    });
    expect(pending.pending).toBe(true);
    const orderFn = read('supabase/functions/create-seller-credit-order/index.ts');
    expect(orderFn).toMatch(/payment_capture: 1/);
    expect(orderFn).toMatch(/razorpayMessage/);
    expect(read('src/pages/SellerCreditsPage.tsx')).toMatch(/functionInvokeErrorMessage/);
  });
});
