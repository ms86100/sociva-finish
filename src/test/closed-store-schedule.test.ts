import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkoutErrorMessage } from '@/lib/checkout-guards';
import {
  canScheduleWhileClosed,
  earliestScheduleSlot,
  formatScheduleCta,
  isValidScheduleSlot,
} from '@/lib/store-schedule';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

const tenPmIst = new Date('2026-10-21T16:30:00.000Z');
const cafeHours = {
  availabilityStart: '09:00',
  availabilityEnd: '21:00',
  operatingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  isAvailable: true,
  vacationMode: false,
  prepMinutes: 15,
};

describe('closed-store scheduled ordering contracts', () => {
  it('maps 10 PM to the next 9:45 AM slot', () => {
    const earliest = earliestScheduleSlot(cafeHours, tenPmIst);
    expect(earliest?.date).toBe('2026-10-22');
    expect(earliest?.time).toBe('09:45');
    expect(formatScheduleCta(cafeHours, tenPmIst)).toBe('Schedule for 9:45 AM tomorrow');
  });

  it('rejects a 2 AM slot and accepts 9:45 AM', () => {
    expect(isValidScheduleSlot(cafeHours, '2026-10-22', '09:45', tenPmIst)).toBe(true);
    expect(isValidScheduleSlot(cafeHours, '2026-10-22', '09:15', tenPmIst)).toBe(false);
    expect(isValidScheduleSlot(cafeHours, '2026-10-22', '02:00', tenPmIst)).toBe(false);
    expect(canScheduleWhileClosed('closed', false)).toBe(true);
    expect(canScheduleWhileClosed('paused', false)).toBe(false);
  });

  it('seller store menu stamps hours so closed items show Schedule, not ADD', () => {
    const sellerPage = read('src/pages/SellerDetailPage.tsx');
    expect(sellerPage).toMatch(/seller_availability_start: sellerData.availability_start/);
    expect(sellerPage).toMatch(/seller_vacation_mode: sellerData.vacation_mode/);
    expect(sellerPage).toMatch(/canScheduleWhileClosed/);
    expect(sellerPage).toMatch(/Tap Schedule on an item, then pick a time in your cart/);
  });

  it('search listing cards inherit marketplace seller hours for Schedule CTAs', () => {
    const search = read('src/pages/SearchPage.tsx');
    expect(search).toMatch(/seller_availability_start: seller\?\.availability_start/);
    expect(search).toMatch(/seller_vacation_mode: seller\?\.vacation_mode/);
  });

  it('listing CTAs stay on closed cards as Schedule, not a dead Closed button', () => {
    const listing = read('src/components/product/ProductListingCard.tsx');
    const card = read('src/components/product/ProductCard.tsx');
    const grid = read('src/components/product/ProductGridCard.tsx');
    const detail = read('src/components/product/ProductDetailSheet.tsx');
    for (const src of [listing, card, grid, detail]) {
      expect(src).toMatch(/canScheduleWhileClosed/);
      expect(src).toMatch(/formatScheduleCta/);
    }
    expect(listing).toMatch(/showCartCta/);
    expect(card).toMatch(/ScheduleCtaLabel/);
    expect(listing).toMatch(/ScheduleCtaLabel/);
    expect(grid).toMatch(/ScheduleCtaLabel/);
    expect(read('src/components/product/ScheduleCtaLabel.tsx')).toMatch(/>Schedule</);
    expect(read('src/components/product/ScheduleCtaLabel.tsx')).not.toMatch(/timeLabel/);
    expect(detail).toMatch(/Schedule · /);
  });

  it('cart add allows closed stores and still blocks paused or vacation', () => {
    const cart = read('src/hooks/useCart.tsx');
    expect(cart).toMatch(/canScheduleWhileClosed/);
    expect(cart).toMatch(/isHardBlockedStore/);
    expect(cart).toMatch(/formatClosedStoreAddPopupCopy/);
    expect(cart).toMatch(/vacation_mode/);
    // Size sheet owns closed-store guidance - no floating toast that leaves buyers lost
    expect(cart).not.toMatch(/else if \(addPopupCopy\) \{\s*toast\(addPopupCopy\.message/);
    const sheet = read('src/components/product/VariantPickerSheet.tsx');
    expect(sheet).toMatch(/Schedule in cart/);
    expect(sheet).toMatch(/variant-schedule-hint/);
    expect(sheet).toMatch(/needsSchedule/);
  });

  it('Place Order stays disabled until a slot is chosen for closed-store carts', () => {
    const page = read('src/pages/CartPage.tsx');
    const hook = read('src/hooks/useCartPage.ts');
    expect(page).toMatch(/c\.preorderMissingSchedule/);
    expect(page).toMatch(/storeHours=\{c\.scheduleStoreHours\}/);
    expect(page).toMatch(/Checkout this store/);
    expect(hook).toMatch(/schedulingRequired/);
    expect(hook).toMatch(/mixedOpenAndClosedCart/);
    expect(hook).toMatch(/pickValidScheduleSlot/);
    expect(hook).not.toMatch(/if \(!scheduleSlotValid\) setScheduledTime\(null\)/);
    expect(hook).toContain("notify.block('Please select a delivery date & time for this order.')");
  });

  it('picker uses store-hour slots instead of a 6 AM-10 PM grid', () => {
    const picker = read('src/components/checkout/PreorderDatePicker.tsx');
    expect(picker).toMatch(/listScheduleSlots/);
    expect(picker).not.toMatch(/for \(let h = 6; h <= 22/);
    expect(picker).toMatch(/storeHours/);
  });

  it('server validates slots and does not trust client _preorder_seller_ids as a bypass', () => {
    const mig = read('supabase/migrations/20261021220000_closed_store_scheduled_ordering.sql');
    expect(mig).toMatch(/FUNCTION public\.seller_scheduled_slot_is_valid/);
    expect(mig).toMatch(/schedule_required/);
    expect(mig).toMatch(/invalid_schedule_slot/);
    expect(mig).toMatch(/compute_store_status\(sp\.availability_start, sp\.availability_end, sp\.operating_days/);
    expect(mig).toMatch(/_must_schedule/);
    expect(mig).toMatch(/vacation_mode/);
    expect(mig).toMatch(/Ignore client _preorder_seller_ids as a bypass|stop trusting|_must_schedule := /);
    expect(mig).toContain("if _scheduled_date is not null and _scheduled_time_start is not null then");
  });

  it('labels the existing seller new-order push as scheduled and keeps the reminder cron', () => {
    const mig = read('supabase/migrations/20261021220000_closed_store_scheduled_ordering.sql');
    expect(mig).toContain("Scheduled order for ' || v_when");
    expect(mig).toMatch(/enqueue_seller_new_order_notification/);
    const reminders = read('supabase/functions/send-scheduled-order-reminders/index.ts');
    expect(reminders).toMatch(/scheduled_prep|scheduled_late/);
    const acceptReminders = read('supabase/functions/send-seller-status-reminders/index.ts');
    expect(acceptReminders).toContain('scheduled_accept');
    expect(acceptReminders).toContain('Accept this scheduled order');
  });

  it('maps closed-store checkout errors for the cart', () => {
    expect(checkoutErrorMessage('schedule_required')).toMatch(/closed/i);
    expect(checkoutErrorMessage('invalid_schedule_slot')).toMatch(/hours/i);
  });

  it('open-store immediate checkout path still sends a null slot when the toggle is off', () => {
    const hook = read('src/hooks/useCartPage.ts');
    expect(hook).toMatch(/sendScheduledSlot && scheduledDate/);
    expect(hook).toMatch(/create_multi_vendor_orders/);
  });

  it('hides the ready-in ETA and shows the slot on the confirm dialog', () => {
    const hook = read('src/hooks/useCartPage.ts');
    const page = read('src/pages/CartPage.tsx');
    expect(hook).toMatch(/mustSchedule/);
    expect(hook).toMatch(/scheduledSlotLabel/);
    expect(hook).toMatch(/isValidIntersectedSlot/);
    expect(page).toMatch(/c\.sendScheduledSlot && c\.scheduledSlotLabel/);
    expect(page).toMatch(/Scheduled/);
  });

  it('tells the buyer the seller confirms when they open, on confirm and the order page', () => {
    const page = read('src/pages/CartPage.tsx');
    const picker = read('src/components/checkout/PreorderDatePicker.tsx');
    const banner = read('src/components/orders/ScheduledOrderBanner.tsx');
    const detail = read('src/pages/OrderDetailPage.tsx');
    const sellerCard = read('src/components/seller/SellerOrderCard.tsx');
    expect(page).toMatch(/formatClosedStoreBuyerConfirmCopy/);
    expect(page).toMatch(/c\.hasClosedScheduleItems/);
    expect(page).toMatch(/c\.closedStoreAcceptByLabel/);
    expect(picker).toMatch(/CLOSED_STORE_BUYER_CONFIRM_COPY/);
    expect(banner).toMatch(/formatClosedStoreBuyerConfirmCopy/);
    expect(banner).toMatch(/formatClosedStoreSellerAcceptCopy/);
    expect(banner).toMatch(/isClosedStoreScheduledOrder/);
    expect(detail).toMatch(/!isUpcomingScheduled\(order as any\)/);
    expect(sellerCard).toMatch(/Accept by/);
    expect(read('src/components/seller/UpcomingScheduledPanel.tsx')).toMatch(/Slot confirmed\. Preparation unlocks at the scheduled window\./);
  });

  it('pushes the first closed-store slot later and expires at prep start', () => {
    const mig = read('supabase/migrations/20261021250000_closed_store_prep_accept_window.sql');
    expect(mig).toMatch(/v_start_m \+ v_prep \+ 30/);
    expect(mig).toMatch(/v_prep_start := v_slot - make_interval/);
    expect(mig).toMatch(/_prep_minutes/);
    expect(mig).toMatch(/trg_refresh_order_scheduled_times_from_items/);
    expect(mig).toMatch(/SET lc_time TO 'C'/);
  });

  it('does not auto-cancel a closed-store scheduled order after 30 minutes', () => {
    const mig = read('supabase/migrations/20261021233000_closed_store_schedule_autocancel.sql');
    expect(mig).toMatch(/if _must_schedule then/);
    expect(mig).toMatch(/AT TIME ZONE 'Asia\/Kolkata'/);
    expect(mig).toMatch(/now\(\) \+ interval '30 minutes'/);
    expect(mig).toMatch(/SET lc_time = 'C'/);
  });

  it('auto-selects the earliest valid slot for required closed-store checkout', () => {
    const hook = read('src/hooks/useCartPage.ts');
    expect(hook).toMatch(/if \(!schedulingRequired \|\| scheduleSlotsEmpty\) return/);
    expect(hook).toMatch(/pickValidScheduleSlot/);
    expect(hook).not.toMatch(/if \(!scheduleSlotValid\) setScheduledTime\(null\)/);
  });

  it('tells the buyer the closed-store add still needs a cart slot', () => {
    const cart = read('src/hooks/useCart.tsx');
    const popup = read('src/components/ui/CartAddPopup.tsx');
    expect(cart).toMatch(/formatClosedStoreAddPopupCopy/);
    expect(cart).toMatch(/stampProductSellerHours/);
    expect(cart).toMatch(/\.select\('quantity'\)/);
    expect(cart).not.toMatch(/product:products!inner/);
    expect(read('src/hooks/useCartCount.ts')).toMatch(/\.select\('quantity'\)/);
    expect(read('src/hooks/useCartCount.ts')).not.toMatch(/product:products!inner/);
    expect(popup).toMatch(/title \|\| 'Added to cart'/);
    expect(popup).toMatch(/primaryLabel \|\| 'View cart'/);
    expect(popup).toMatch(/secondaryLabel \|\| 'Continue'/);
  });

  it('keeps a vacation store listed with On a break, and does not hide it as a location miss', () => {
    const settings = read('src/pages/SellerSettingsPage.tsx');
    const sellerPage = read('src/pages/SellerDetailPage.tsx');
    const mig = read('supabase/migrations/20261021260000_vacation_keeps_store_listed.sql');
    const card = read('src/components/product/ProductCard.tsx');
    expect(settings).toMatch(/Store stays listed\. Buyers see On a break and cannot order until you return\./);
    expect(sellerPage).toMatch(/vacationVisible/);
    expect(sellerPage).toMatch(/orders are paused/);
    expect(mig).toMatch(/reason', 'vacation'/);
    expect(mig).not.toMatch(/IF COALESCE\(v_sp\.vacation_mode, false\) THEN\s+RETURN false;/);
    expect(card).toMatch(/VACATION_BUYER_CTA/);
    expect(read('src/lib/sellerDiscoverability.ts')).toMatch(/reason === 'vacation'/);
    expect(read('src/hooks/useCart.tsx')).toMatch(/eligibility.reason === 'vacation'/);
  });

  it('does not blur listing photos when a closed store can be scheduled', () => {
    const listing = read('src/components/product/ProductListingCard.tsx');
    const grid = read('src/components/product/ProductGridCard.tsx');
    const card = read('src/components/product/ProductCard.tsx');
    expect(listing).toMatch(/isStoreClosed && !isUnavailable && !canScheduleClosed && 'opacity-55 grayscale-\[25%\]'/);
    expect(listing).toMatch(/isStoreClosed && !isUnavailable && canScheduleClosed && storeClosedMessage/);
    expect(listing).toContain('backdrop-blur-[1.5px]');
    expect(listing).toMatch(/isStoreClosed && !isUnavailable && !canScheduleClosed && \(/);
    expect(grid).toMatch(/isStoreClosed && !isOutOfStock && !canScheduleClosed && 'opacity-60 grayscale-\[30%\]'/);
    expect(grid).toMatch(/isStoreClosed && !isOutOfStock && canScheduleClosed && storeClosedMessage/);
    expect(card).toMatch(/isStoreClosed && product\.is_available && canScheduleClosed && storeClosedMessage/);
  });

  it('lets reorder and recently viewed add from a closed store that can be scheduled', () => {
    const reorder = read('src/lib/reorder.ts');
    const reorderBtn = read('src/components/order/ReorderButton.tsx');
    const lastOrder = read('src/components/home/ReorderLastOrder.tsx');
    const recent = read('src/components/home/RecentlyViewedRow.tsx');
    expect(reorder).toMatch(/inspectReorderStores/);
    expect(reorder).toMatch(/canScheduleWhileClosed/);
    expect(reorder).toMatch(/vacation_mode/);
    expect(reorderBtn).toMatch(/reorderGate\.schedule/);
    expect(lastOrder).toMatch(/inspectReorderStores/);
    expect(recent).toMatch(/canScheduleWhileClosed/);
    expect(recent).toMatch(/addBlocked/);
  });
});
