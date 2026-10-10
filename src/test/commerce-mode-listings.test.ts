import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ method: string; args: unknown[] }> = [];
let pages: Array<{ data: any[] | null; error: any }> = [];

vi.mock('@/integrations/supabase/client', () => {
  const builder: any = {};
  for (const method of ['from', 'select', 'eq', 'order']) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.range = (...args: unknown[]) => {
    calls.push({ method: 'range', args });
    return Promise.resolve(pages.shift() ?? { data: [], error: null });
  };
  return { supabase: builder };
});

import {
  SELLER_LISTING_CAP,
  bucketListingsByMode,
  cappedSellerIds,
  fetchSellerListingsTopUp,
  mergeTopUpListings,
} from '@/hooks/queries/useCommerceModeListings';
import { resolveCommerceMode, type CategoryActionConfig } from '@/lib/commerce-mode';

const configs: CategoryActionConfig[] = [
  { category: 'home_food', transactionType: 'cart_purchase', behavior: { supportsCart: true, enquiryOnly: false } },
  { category: 'yoga', transactionType: 'book_slot', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'plumbing', transactionType: 'request_service', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'tuition', transactionType: 'contact_enquiry', behavior: { supportsCart: false, enquiryOnly: true } },
  { category: 'odd_flags', transactionType: 'self_fulfillment_x', behavior: { supportsCart: false, enquiryOnly: true } },
];

const seller = (id: string, items: any[], extra: Record<string, unknown> = {}) => ({
  seller_id: id,
  business_name: `Seller ${id}`,
  rating: 4.5,
  total_reviews: 10,
  distance_km: 0.3,
  matching_products: items,
  ...extra,
}) as any;

const item = (id: string, category: string, action_type: string | null, price = 100) => ({
  id,
  name: `Item ${id}`,
  price,
  category,
  action_type,
  image_url: null,
  is_veg: true,
  is_available: true,
});

describe('bucketListingsByMode', () => {
  const sellers = [
    seller('s1', [
      item('cart', 'home_food', 'add_to_cart'),
      item('buy', 'home_food', 'buy_now'),
      item('book', 'yoga', 'book'),
      item('visit', 'yoga', 'schedule_visit'),
      item('svc', 'plumbing', 'request_service'),
      item('quote', 'plumbing', 'request_quote'),
      item('offer', 'plumbing', 'make_offer'),
      item('contact', 'tuition', 'contact_seller'),
    ]),
    seller('s2', [
      item('null-cart', 'home_food', null),
      item('null-book', 'yoga', null),
      item('null-svc', 'plumbing', null),
      item('null-contact', 'tuition', null),
      item('null-flags', 'odd_flags', null),
      item('null-unknown', 'no_config', null),
      item('conflict', 'tuition', 'add_to_cart'),
      item('cart', 'home_food', 'add_to_cart'),
    ]),
  ];

  const ids = (list: Array<{ id: string }>) => list.map((p) => p.id).sort();

  it('puts cart actions only in shop, booking only in book, enquiry/contact only in services', () => {
    const b = bucketListingsByMode(sellers, configs);
    expect(ids(b.shop)).toEqual(['buy', 'cart', 'null-cart', 'null-unknown']);
    expect(ids(b.book)).toEqual(['book', 'null-book', 'visit']);
    expect(ids(b.services)).toEqual(
      ['conflict', 'contact', 'null-contact', 'null-flags', 'null-svc', 'offer', 'quote', 'svc'],
    );
  });

  it('agrees with the shared resolver for every listing and omits nothing', () => {
    const b = bucketListingsByMode(sellers, configs);
    for (const mode of ['shop', 'book', 'services'] as const) {
      for (const listing of b[mode]) {
        expect(resolveCommerceMode(listing, configs), listing.id).toBe(mode);
      }
    }
    const unique = new Set(sellers.flatMap((s) => s.matching_products.map((p: any) => p.id)));
    expect(b.shop.length + b.book.length + b.services.length).toBe(unique.size);
  });

  it('resolves a null action from the category instead of the add_to_cart mapping default', () => {
    const b = bucketListingsByMode(sellers, configs);
    const all = [...b.shop, ...b.book, ...b.services];
    const byId = (id: string) => all.find((p) => p.id === id)!;
    expect(byId('null-book').action_type).toBe('book');
    expect(byId('null-svc').action_type).toBe('request_service');
    expect(byId('null-contact').action_type).toBe('contact_seller');
    expect(byId('null-flags').action_type).toBe('contact_seller');
    expect(byId('null-unknown').action_type).toBe('add_to_cart');
  });

  it('keeps an explicit stale cart action raw but classifies it by the category rule', () => {
    const b = bucketListingsByMode(sellers, configs);
    const conflict = b.services.find((p) => p.id === 'conflict')!;
    expect(conflict.action_type).toBe('add_to_cart');
    expect(b.shop.some((p) => p.id === 'conflict')).toBe(false);
  });

  it('maps seller fields the same way as the shared marketplace mapper', () => {
    const b = bucketListingsByMode(sellers, configs);
    const listing = b.book.find((p) => p.id === 'book')!;
    expect(listing.seller_id).toBe('s1');
    expect(listing.seller_name).toBe('Seller s1');
    expect(listing.is_same_society).toBe(true);
  });

  it('falls back safely before category configs load', () => {
    const b = bucketListingsByMode(sellers, []);
    expect(b.book.map((p) => p.id)).toContain('book');
    expect(b.services.map((p) => p.id)).toContain('contact');
  });
});

describe('capped seller top-up', () => {
  const fullSeller = seller('big', Array.from({ length: SELLER_LISTING_CAP }, (_, i) => item(`b${i}`, 'yoga', 'book')));
  const smallSeller = seller('small', [item('x1', 'home_food', 'add_to_cart')]);

  it('only tops up sellers the RPC cap may have truncated', () => {
    expect(cappedSellerIds([smallSeller, fullSeller])).toEqual(['big']);
  });

  it('appends missing listings after the RPC rows and dedupes', () => {
    const merged = mergeTopUpListings([fullSeller, smallSeller], [
      { ...item('b0', 'yoga', 'book'), seller_id: 'big' },
      { ...item('b60', 'yoga', 'book'), seller_id: 'big' },
      { ...item('b61', 'yoga', 'book'), seller_id: 'big' },
    ]);
    const big = merged.find((s) => s.seller_id === 'big')!;
    expect(big.matching_products).toHaveLength(SELLER_LISTING_CAP + 2);
    expect(big.matching_products[0].id).toBe('b0');
    expect(big.matching_products.slice(-2).map((p: any) => p.id)).toEqual(['b60', 'b61']);
    expect(merged.find((s) => s.seller_id === 'small')).toBe(smallSeller);
  });

  it('returns the RPC rows untouched when the top-up has not loaded or failed', () => {
    const sellers = [fullSeller];
    expect(mergeTopUpListings(sellers, undefined)).toBe(sellers);
    expect(mergeTopUpListings(sellers, [])).toBe(sellers);
  });
});

describe('fetchSellerListingsTopUp', () => {
  beforeEach(() => {
    calls.length = 0;
    pages = [];
  });

  it('uses the storefront filters and pages until a short page', async () => {
    pages = [
      { data: Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, seller_id: 'big' })), error: null },
      { data: [{ id: 'p1000', seller_id: 'big' }], error: null },
    ];
    const rows = await fetchSellerListingsTopUp(['big']);
    expect(rows).toHaveLength(1001);
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['seller_id', 'big']);
    expect(eqs).toContainEqual(['is_available', true]);
    expect(eqs).toContainEqual(['approval_status', 'approved']);
    expect(calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 999], [1000, 1999]]);
    expect(calls.find((c) => c.method === 'from')?.args).toEqual(['products']);
  });

  it('throws so the page can show a real error instead of an empty list', async () => {
    pages = [{ data: null, error: { message: 'timeout' } }];
    await expect(fetchSellerListingsTopUp(['big'])).rejects.toEqual({ message: 'timeout' });
  });
});
