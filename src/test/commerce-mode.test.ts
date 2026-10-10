import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTION_TO_MODE,
  categoriesOwnedByMode,
  filterByMode,
  modeForAction,
  owningModeForCategory,
  resolveCommerceMode,
  resolveListingAction,
  type CategoryActionConfig,
  type CommerceMode,
} from '@/lib/commerce-mode';
import { ACTION_CONFIG, TX_TO_ACTION } from '@/lib/marketplace-constants';
import { productMatchesCommerceFacets, extractAvailableCommerceFacets, emptyCommerceFacetState } from '@/lib/commerce-facets';
import { suggestionIntent } from '@/lib/searchSuggestionRules';
import { isSocietyEntryVisible } from '@/hooks/useSocietyEntryVisible';
import type { ProductActionType } from '@/types/Database';

const ALL_ACTIONS = Object.keys(ACTION_CONFIG) as ProductActionType[];

const CONFIGS: CategoryActionConfig[] = [
  { category: 'home_food', transactionType: 'cart_purchase', behavior: { supportsCart: true, enquiryOnly: false } },
  { category: 'salon', transactionType: 'service_booking', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'plumbing', transactionType: 'request_service', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'furniture_resale', transactionType: 'contact_enquiry', behavior: { supportsCart: false, enquiryOnly: true } },
  { category: 'flats', transactionType: 'schedule_visit', behavior: { supportsCart: false, enquiryOnly: false } },
  { category: 'unmapped_cart', transactionType: 'self_service_v2', behavior: { supportsCart: true, enquiryOnly: false } },
  { category: 'unmapped_enquiry', transactionType: null, behavior: { supportsCart: false, enquiryOnly: true } },
  { category: 'unmapped_other', transactionType: null, behavior: { supportsCart: false, enquiryOnly: false } },
];

describe('commerce-mode: action to mode table', () => {
  it('covers every supported action type exactly once', () => {
    expect(Object.keys(ACTION_TO_MODE).sort()).toEqual([...ALL_ACTIONS].sort());
  });

  it('maps every action to the expected mode', () => {
    const expected: Record<ProductActionType, CommerceMode> = {
      add_to_cart: 'shop',
      buy_now: 'shop',
      book: 'book',
      schedule_visit: 'book',
      request_service: 'services',
      request_quote: 'services',
      make_offer: 'services',
      contact_seller: 'services',
    };
    for (const action of ALL_ACTIONS) expect(modeForAction(action)).toBe(expected[action]);
  });

  it('shop mode is exactly the set of cart actions (ACTION_CONFIG.isCart)', () => {
    for (const action of ALL_ACTIONS) {
      expect(modeForAction(action) === 'shop').toBe(ACTION_CONFIG[action].isCart);
    }
  });

  it('matches action_type_workflow_map.checkout_mode in the seed migration', () => {
    const dir = resolve(process.cwd(), 'supabase/migrations');
    const file = readdirSync(dir).find((f) => f.startsWith('20260403164152_197821d2'));
    expect(file).toBeTruthy();
    const sql = readFileSync(resolve(dir, file!), 'utf8');
    const rows = [...sql.matchAll(/\('(\w+)',\s*'(\w+)',\s*'(\w+)',/g)].map((m) => ({
      action: m[1] as ProductActionType,
      checkoutMode: m[3],
    }));
    const seeded = rows.filter((r) => ALL_ACTIONS.includes(r.action));
    expect(seeded.map((r) => r.action).sort()).toEqual([...ALL_ACTIONS].sort());
    const checkoutToMode: Record<string, CommerceMode> = {
      cart: 'shop',
      booking: 'book',
      inquiry: 'services',
      contact: 'services',
    };
    for (const { action, checkoutMode } of seeded) {
      expect(checkoutToMode[checkoutMode], `${action} -> ${checkoutMode}`).toBe(modeForAction(action));
    }
  });
});

describe('commerce-mode: resolveListingAction', () => {
  it('honours every explicit product action type when the category allows it', () => {
    for (const action of ALL_ACTIONS) {
      expect(resolveListingAction(action, 'home_food', CONFIGS)).toBe(action);
    }
  });

  it('null action type falls back to each category transaction type', () => {
    for (const [tx, mapped] of Object.entries(TX_TO_ACTION)) {
      const cfg: CategoryActionConfig[] = [{ category: 'c', transactionType: tx, behavior: null }];
      expect(resolveListingAction(null, 'c', cfg), tx).toBe(mapped);
      expect(resolveListingAction(undefined, 'c', cfg), tx).toBe(mapped);
      expect(resolveListingAction('', 'c', cfg), tx).toBe(mapped);
    }
  });

  it('null action type resolves by category for the fixture categories', () => {
    expect(resolveListingAction(null, 'home_food', CONFIGS)).toBe('add_to_cart');
    expect(resolveListingAction(null, 'salon', CONFIGS)).toBe('book');
    expect(resolveListingAction(null, 'plumbing', CONFIGS)).toBe('request_service');
    expect(resolveListingAction(null, 'furniture_resale', CONFIGS)).toBe('contact_seller');
    expect(resolveListingAction(null, 'flats', CONFIGS)).toBe('schedule_visit');
  });

  it('falls back to behavior flags when the transaction type is unmapped or missing', () => {
    expect(resolveListingAction(null, 'unmapped_cart', CONFIGS)).toBe('add_to_cart');
    expect(resolveListingAction(null, 'unmapped_enquiry', CONFIGS)).toBe('contact_seller');
    expect(resolveListingAction(null, 'unmapped_other', CONFIGS)).toBe('book');
  });

  it('conflict: stale cart action in a category that forbids cart is demoted, never shop', () => {
    expect(resolveListingAction('add_to_cart', 'salon', CONFIGS)).toBe('book');
    expect(resolveListingAction('buy_now', 'salon', CONFIGS)).toBe('book');
    expect(resolveListingAction('add_to_cart', 'plumbing', CONFIGS)).toBe('request_service');
    expect(resolveListingAction('add_to_cart', 'furniture_resale', CONFIGS)).toBe('contact_seller');
    expect(resolveListingAction('add_to_cart', 'unmapped_other', CONFIGS)).toBe('request_quote');
    expect(resolveCommerceMode({ action_type: 'add_to_cart', category: 'salon' }, CONFIGS)).toBe('book');
  });

  it('conflict: explicit non-cart product action beats a cart category', () => {
    expect(resolveListingAction('book', 'home_food', CONFIGS)).toBe('book');
    expect(resolveListingAction('contact_seller', 'home_food', CONFIGS)).toBe('contact_seller');
    expect(resolveListingAction('contact_seller', 'salon', CONFIGS)).toBe('contact_seller');
  });

  it('unknown action strings are ignored in favour of the category', () => {
    expect(resolveListingAction('teleport', 'salon', CONFIGS)).toBe('book');
  });

  it('without configs keeps the legacy add_to_cart default (no behavior change)', () => {
    expect(resolveListingAction(null, 'salon')).toBe('add_to_cart');
    expect(resolveListingAction(null, null, CONFIGS)).toBe('add_to_cart');
    expect(resolveListingAction(null, 'not_configured', CONFIGS)).toBe('add_to_cart');
    expect(resolveListingAction('book', 'not_configured', CONFIGS)).toBe('book');
  });
});

describe('commerce-mode: filterByMode', () => {
  const listings = [
    { id: 1, action_type: 'add_to_cart', category: 'home_food' },
    { id: 2, action_type: null, category: 'salon' },
    { id: 3, action_type: 'add_to_cart', category: 'salon' },
    { id: 4, action_type: 'contact_seller', category: 'furniture_resale' },
    { id: 5, action_type: null, category: 'flats' },
    { id: 6, action_type: 'request_quote', category: 'plumbing' },
  ];

  it('partitions every listing into exactly one mode, losing nothing', () => {
    const shop = filterByMode(listings, 'shop', CONFIGS).map((l) => l.id);
    const book = filterByMode(listings, 'book', CONFIGS).map((l) => l.id);
    const services = filterByMode(listings, 'services', CONFIGS).map((l) => l.id);
    expect(shop).toEqual([1]);
    expect(book).toEqual([2, 3, 5]);
    expect(services).toEqual([4, 6]);
    expect([...shop, ...book, ...services].sort()).toEqual(listings.map((l) => l.id).sort());
  });
});

describe('commerce-facets use the shared resolver', () => {
  it('action facet matches a null-action product by its category transaction type', () => {
    const product = { action_type: null, category: 'salon' };
    const state = { ...emptyCommerceFacetState(), actionType: 'book' };
    expect(productMatchesCommerceFacets(product, state, CONFIGS)).toBe(true);
    expect(productMatchesCommerceFacets(product, { ...state, actionType: 'add_to_cart' }, CONFIGS)).toBe(false);
  });

  it('action facet no longer counts a stale cart listing in a booking category as Direct Buy', () => {
    const products = [
      { action_type: 'add_to_cart', category: 'salon' },
      { action_type: null, category: 'salon' },
    ];
    const chips = extractAvailableCommerceFacets(products, { categoryConfigs: CONFIGS });
    const actionChips = chips.filter((c) => c.type === 'action_type');
    expect(actionChips.map((c) => [c.value, c.count])).toEqual([['book', 2]]);
  });

  it('without configs the facet path is unchanged', () => {
    const chips = extractAvailableCommerceFacets([{ action_type: null, category: 'salon' }]);
    expect(chips.filter((c) => c.type === 'action_type').map((c) => c.value)).toEqual(['add_to_cart']);
  });
});

describe('search autocomplete grouping uses the shared resolver', () => {
  it('groups each action into the matching section', () => {
    const expected: Record<ProductActionType, string> = {
      add_to_cart: 'products',
      buy_now: 'products',
      book: 'bookable',
      schedule_visit: 'bookable',
      request_service: 'services',
      request_quote: 'enquiries',
      make_offer: 'enquiries',
      contact_seller: 'enquiries',
    };
    for (const action of ALL_ACTIONS) {
      expect(suggestionIntent({ action_type: action, category: 'home_food' }, CONFIGS), action).toBe(expected[action]);
    }
  });

  it('null action type is grouped by category, and stale cart actions are not shown as products', () => {
    expect(suggestionIntent({ action_type: null, category: 'salon' }, CONFIGS)).toBe('bookable');
    expect(suggestionIntent({ action_type: 'add_to_cart', category: 'salon' }, CONFIGS)).toBe('bookable');
    expect(suggestionIntent({ action_type: null, category: 'plumbing' }, CONFIGS)).toBe('services');
  });
});

describe('society entry visibility (BottomNav and Profile share one rule)', () => {
  const base = { effectiveSocietyId: 'soc-1', isAdmin: false, featuresLoading: false, hasAnyFeature: true };
  it('visible for a society member with at least one feature', () => {
    expect(isSocietyEntryVisible(base)).toBe(true);
  });
  it('hidden without a society unless admin', () => {
    expect(isSocietyEntryVisible({ ...base, effectiveSocietyId: null })).toBe(false);
    expect(isSocietyEntryVisible({ ...base, effectiveSocietyId: null, isAdmin: true })).toBe(true);
  });
  it('hidden when the society has no features enabled, except for admins', () => {
    expect(isSocietyEntryVisible({ ...base, hasAnyFeature: false })).toBe(false);
    expect(isSocietyEntryVisible({ ...base, hasAnyFeature: false, isAdmin: true })).toBe(true);
  });
  it('stays visible while features are still loading', () => {
    expect(isSocietyEntryVisible({ ...base, featuresLoading: true, hasAnyFeature: false })).toBe(true);
  });
});

describe('category chip ownership', () => {
  const buckets = {
    shop: [{ category: 'home_food' }, { category: 'home_food' }],
    book: [
      { category: 'salon' },
      { category: 'salon' },
      { category: 'salon' },
      { category: 'medical' },
    ],
    services: [
      { category: 'salon' },
      { category: 'tuition' },
      { category: 'tuition' },
      { category: 'medical' },
    ],
  };

  it('gives a category to the mode with more listings', () => {
    expect(owningModeForCategory({ book: 3, services: 1 }, 'salon', CONFIGS)).toBe('book');
    expect(owningModeForCategory({ services: 2 }, 'tuition', CONFIGS)).toBe('services');
  });

  it('uses the category transaction type when the counts tie', () => {
    expect(owningModeForCategory({ book: 2, services: 2 }, 'salon', CONFIGS)).toBe('book');
    expect(owningModeForCategory({ book: 2, services: 2 }, 'plumbing', CONFIGS)).toBe('services');
  });

  it('does not repeat a chip on the mode that lost the count', () => {
    expect([...categoriesOwnedByMode(buckets, 'book', CONFIGS)].sort()).toEqual(['medical', 'salon']);
    expect([...categoriesOwnedByMode(buckets, 'services', CONFIGS)].sort()).toEqual(['tuition']);
    expect([...categoriesOwnedByMode(buckets, 'shop', CONFIGS)]).toEqual(['home_food']);
  });
});
