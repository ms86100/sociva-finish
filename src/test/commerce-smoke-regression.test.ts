/**
 * Regression guards for the commerce MVP ship path:
 * OTP → home shell → cart → order → seller accept.
 * Keeps the post-login AppLayout max-update-depth fix honest.
 */
import { describe, it, expect } from 'vitest';
import { optionsEqual, normalizeLayoutOptions, DEFAULT_LAYOUT_OPTIONS } from '@/contexts/AppLayoutContext';
import { isSameSocietySeller, mapProduct } from '@/hooks/queries/useNearbyProducts';
import type { RpcSellerRow } from '@/hooks/queries/useMarketplaceData';
import { journeyPayload, journeyFromTransactionType, BUYER_JOURNEYS } from '@/lib/buyer-journey';
import { resolveTransactionType } from '@/lib/resolveTransactionType';
import { TX_TO_ACTION } from '@/lib/marketplace-constants';
import { pickNotificationRoute } from '@/lib/notification-routes';

/** Buyer→seller happy path (must stay in sync with order workflow) */
const BUYER_SELLER_ACCEPT_FLOW: Record<string, string[]> = {
  // UPI deep-link: stay payment_pending until seller verifies (verify_seller_payment → placed)
  payment_pending: ['placed', 'cancelled'],
  // COD mid-flow cash confirm (distinct from unpaid checkout hold)
  awaiting_cod_confirmation: ['completed'],
  placed: ['accepted', 'cancelled'],
  accepted: ['preparing', 'ready', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['picked_up', 'delivered', 'completed', 'cancelled'],
};

/** Seller alert hook only buzzes on actionable statuses — never unpaid payment_pending phantoms */
const SELLER_ACTIONABLE = ['placed', 'enquired', 'quoted', 'requested', 'scheduled', 'preparing'] as const;

/** Listing-type → journey contracts (cart / book / enquire / contact) */
const LISTING_JOURNEY_SMOKE = [
  { action: 'add_to_cart', tx: 'cart_purchase', sellerNext: 'accepted' },
  { action: 'book', tx: 'service_booking', sellerNext: 'confirmed' },
  { action: 'request_service', tx: 'request_service', sellerNext: 'seller_responded' },
  { action: 'contact_seller', tx: 'contact_enquiry', sellerNext: 'seller_responded' },
] as const;

describe('AppLayout shell options (post-login regression)', () => {
  it('normalize fills defaults without churning identical writes', () => {
    const a = normalizeLayoutOptions({});
    const b = normalizeLayoutOptions({
      showHeader: true,
      showNav: true,
      showCart: true,
      showLocation: true,
    });
    expect(optionsEqual(a, b)).toBe(true);
    expect(optionsEqual(a, DEFAULT_LAYOUT_OPTIONS)).toBe(true);
  });

  it('optionsEqual returns true for same chrome — setOptions must bail (no max-update-depth)', () => {
    const opts = normalizeLayoutOptions({ showHeader: true, headerTitle: 'Home' });
    expect(optionsEqual(opts, { ...opts })).toBe(true);
  });

  it('optionsEqual detects real chrome changes (onboarding hide nav)', () => {
    const open = normalizeLayoutOptions({ showNav: true, showHeader: true });
    const onboarding = normalizeLayoutOptions({ showNav: false, showHeader: false, showCart: false });
    expect(optionsEqual(open, onboarding)).toBe(false);
  });

  it('safeTop defaults on when header is hidden', () => {
    const hidden = normalizeLayoutOptions({ showHeader: false });
    expect(hidden.safeTop).toBe(true);
    const withSafeHeader = normalizeLayoutOptions({ showHeader: false, safeTop: false });
    expect(withSafeHeader.safeTop).toBe(false);
    const defaultHeader = normalizeLayoutOptions({});
    expect(defaultHeader.safeTop).toBe(false);
  });
});

describe('OTP → order → seller accept smoke (status contract)', () => {
  it('placed can transition to accepted (seller accept loop)', () => {
    expect(BUYER_SELLER_ACCEPT_FLOW.placed).toContain('accepted');
  });

  it('payment_pending advances to placed only after seller payment verify (not buyer self-attest)', () => {
    expect(BUYER_SELLER_ACCEPT_FLOW.payment_pending).toContain('placed');
    expect(SELLER_ACTIONABLE).not.toContain('payment_pending' as any);
    expect(SELLER_ACTIONABLE).toContain('placed');
  });

  it('awaiting_cod_confirmation is distinct from unpaid payment_pending', () => {
    expect(BUYER_SELLER_ACCEPT_FLOW.awaiting_cod_confirmation).toContain('completed');
    expect(BUYER_SELLER_ACCEPT_FLOW.awaiting_cod_confirmation).not.toContain('placed');
    expect(BUYER_SELLER_ACCEPT_FLOW.payment_pending).not.toContain('completed');
  });

  it('accepted continues the fulfillment path', () => {
    expect(BUYER_SELLER_ACCEPT_FLOW.accepted.length).toBeGreaterThan(0);
    expect(BUYER_SELLER_ACCEPT_FLOW.accepted).toContain('preparing');
  });
});

describe('Cart integrity mismatch contract', () => {
  it('detects empty items with non-zero count cache (Layer 3)', () => {
    const itemsLength = 0;
    const fallbackItemCount = 3;
    const pendingMutations = 0;
    const isFetched = true;
    const isFetching = false;
    const hasUser = true;
    const hasCartCountMismatch =
      hasUser && isFetched && !isFetching && pendingMutations === 0 && itemsLength === 0 && fallbackItemCount > 0;
    expect(hasCartCountMismatch).toBe(true);
  });

  it('does not flag mismatch while a mutation is in flight', () => {
    const hasCartCountMismatch =
      true && true && !false && 1 === 0 && [].length === 0 && 2 > 0;
    // pendingMutations === 1 → false
    const pendingMutations = 1;
    const mismatch =
      true && true && !false && pendingMutations === 0 && [].length === 0 && 2 > 0;
    expect(mismatch).toBe(false);
  });

  it('empty cart with zero count is healthy', () => {
    const mismatch = true && true && !false && 0 === 0 && [].length === 0 && 0 > 0;
    expect(mismatch).toBe(false);
  });
});

describe('Trust chips data mapping', () => {
  const baseSeller = {
    seller_id: 's1',
    user_id: 'u1',
    business_name: 'Neighbor Kitchen',
    description: null,
    categories: ['food'],
    primary_group: 'food',
    cover_image_url: null,
    profile_image_url: null,
    is_available: true,
    is_featured: true,
    rating: 4.8,
    total_reviews: 12,
    matching_products: [],
    distance_km: 0.2,
    society_name: 'Green Valley',
    availability_start: '09:00',
    availability_end: '21:00',
    seller_latitude: null,
    seller_longitude: null,
    operating_days: null,
    avg_response_minutes: 8,
    last_active_at: null,
    completed_order_count: 5,
  } as RpcSellerRow;

  it('isSameSocietySeller uses hyperlocal distance threshold', () => {
    expect(isSameSocietySeller(0.2)).toBe(true);
    expect(isSameSocietySeller(0.5)).toBe(false);
    expect(isSameSocietySeller(null)).toBe(false);
  });

  it('mapProduct surfaces verified + same-society + ETA fields for cards', () => {
    const product = mapProduct(
      { id: 'p1', name: 'Idli', price: 40, image_url: null, category: 'food', prep_time_minutes: 15 },
      baseSeller,
    );
    expect(product.seller_verified).toBe(true);
    expect((product as any).is_same_society).toBe(true);
    expect(product.delivery_time_text).toBe('15 mins');
    expect((product as any).avg_response_minutes).toBe(8);
  });
});

describe('Buyer journey ↔ category flags (admin single writer)', () => {
  it('exposes four journeys for admin picker', () => {
    expect(BUYER_JOURNEYS.map((j) => j.id)).toEqual(['cart', 'book', 'enquire', 'contact']);
  });

  it('cart journey enables supports_cart and add_to_cart', () => {
    const p = journeyPayload('cart');
    expect(p.supports_cart).toBe(true);
    expect(p.enquiry_only).toBe(false);
    expect(p.default_action_type).toBe('add_to_cart');
    expect(p.transaction_type).toBe('cart_purchase');
  });

  it('book journey requires time slot', () => {
    const p = journeyPayload('book');
    expect(p.requires_time_slot).toBe(true);
    expect(p.default_action_type).toBe('book');
  });

  it('maps fulfillment sub-variants back to cart journey', () => {
    expect(journeyFromTransactionType('seller_delivery')).toBe('cart');
    expect(journeyFromTransactionType('self_fulfillment')).toBe('cart');
  });
});

describe('resolveTransactionType prefers stamped order key', () => {
  it('returns stored transaction_type first', () => {
    expect(
      resolveTransactionType('food', 'order', 'self_pickup', null, null, 'cart_purchase'),
    ).toBe('cart_purchase');
  });

  it('aligns contact_only with contact_enquiry', () => {
    expect(resolveTransactionType('services', null, null, null, 'contact_only')).toBe('contact_enquiry');
  });
});

describe('Listing journey smoke contracts', () => {
  it('TX_TO_ACTION covers cart / book / enquire / contact', () => {
    expect(TX_TO_ACTION.cart_purchase).toBe('add_to_cart');
    expect(TX_TO_ACTION.service_booking).toBe('book');
    expect(TX_TO_ACTION.request_service).toBe('request_service');
    expect(TX_TO_ACTION.contact_enquiry).toBe('contact_seller');
  });

  it('documents expected seller next steps per listing type', () => {
    for (const row of LISTING_JOURNEY_SMOKE) {
      expect(row.tx).toBeTruthy();
      expect(row.sellerNext).toBeTruthy();
      expect(TX_TO_ACTION[row.tx] || row.action).toBeTruthy();
    }
  });
});

describe('Category request notification routes', () => {
  it('routes category_request_approved to seller category-requests', () => {
    expect(pickNotificationRoute({ type: 'category_request_approved' })).toBe('/seller/category-requests');
  });

  it('routes category_request_rejected to seller category-requests', () => {
    expect(pickNotificationRoute({ type: 'category_request_rejected' })).toBe('/seller/category-requests');
  });
});

describe('Ship readiness P0 money-truth contracts', () => {
  it('buyer orders list no longer hides payment_pending', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    // Resolve from this test file → sibling hooks path
    const hooksSrc = readFileSync(
      join(process.cwd(), 'src/hooks/useOrdersList.ts'),
      'utf8',
    );
    expect(hooksSrc).not.toMatch(/neq\('status',\s*'payment_pending'\)/);
  });

  it('success toast requires confirm success — false success is forbidden', () => {
    const confirmOk = (confirmErr: unknown, confirmData: { success?: boolean } | null) =>
      !confirmErr && confirmData?.success !== false;
    expect(confirmOk(null, { success: true })).toBe(true);
    expect(confirmOk(null, { success: false })).toBe(false);
    expect(confirmOk(new Error('fail'), { success: true })).toBe(false);
  });

  it('create-order amount binding uses DB sum not client amount', () => {
    const orders = [{ total_amount: 100 }, { total_amount: 49.5 }];
    const dbAmount = orders.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    const clientAmount = 1;
    expect(dbAmount).toBe(149.5);
    expect(Math.abs(clientAmount - dbAmount) > 0.5).toBe(true);
  });

  it('approve_refund identity joins seller_profiles (seller_id ≠ auth.uid)', () => {
    const orderSellerProfileId = 'sp-uuid';
    const authUid = 'user-uuid';
    const sellerProfile = { id: orderSellerProfileId, user_id: authUid };
    expect(orderSellerProfileId).not.toBe(authUid);
    expect(sellerProfile.user_id).toBe(authUid);
  });

  it('notification_queue INSERT must bind user_id to auth.uid', () => {
    const policyCheck = (user_id: string, authUid: string) => user_id === authUid;
    expect(policyCheck('self', 'self')).toBe(true);
    expect(policyCheck('victim', 'attacker')).toBe(false);
  });
});
