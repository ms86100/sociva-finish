/**
 * Section 14 silent-defect regression plan (R1-R7).
 * Keeps deep-link, marketplace mapping, auth gates, and notify routes honest.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveDeepLinkPath,
  sanitizeDeepLinkPath,
  KNOWN_DEEP_LINK_ROUTES,
} from '@/hooks/useDeepLinks';
import { pickNotificationRoute } from '@/lib/notification-routes';
import { mapProduct } from '@/hooks/queries/useNearbyProducts';
import type { RpcSellerRow } from '@/hooks/queries/useMarketplaceData';
import { bucketListingsByMode } from '@/hooks/queries/useCommerceModeListings';
import { isGuestBrowsePath } from '@/lib/guest-browse-routes';
import { guidedDiscoveryHubHref, guidedDiscoverySeeAllHref } from '@/lib/guided-discovery';
import { productShareUrl, storeShareUrl } from '@/lib/sociva-share';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('R1 deep links explore/book/services + share', () => {
  it('resolves explore, book, and services App Links', () => {
    expect(KNOWN_DEEP_LINK_ROUTES.has('explore')).toBe(true);
    expect(KNOWN_DEEP_LINK_ROUTES.has('book')).toBe(true);
    expect(KNOWN_DEEP_LINK_ROUTES.has('services')).toBe(true);
    expect(resolveDeepLinkPath('https://www.sociva.in/#/explore/home_food?tile=meal:dinner')).toBe(
      '/explore/home_food?tile=meal:dinner',
    );
    expect(resolveDeepLinkPath('https://www.sociva.in/book')).toBe('/book');
    expect(resolveDeepLinkPath('https://sociva.in/#/services')).toBe('/services');
  });

  it('maps OG share product and store URLs to in-app routes', () => {
    expect(
      resolveDeepLinkPath('https://www.sociva.in/api/share/product/abc-product?og=1'),
    ).toBe('/product/abc-product');
    expect(resolveDeepLinkPath('https://www.sociva.in/api/share/store/abc-seller')).toBe(
      '/seller/abc-seller',
    );
    expect(productShareUrl('abc-product')).toContain('/api/share/product/abc-product');
    expect(storeShareUrl('abc-seller')).toContain('/api/share/store/abc-seller');
  });
});

describe('R2 unknown deep-link segment never hijacks to /orders', () => {
  it('falls back to / for unknown top segments', () => {
    expect(sanitizeDeepLinkPath('/totally-unknown/xyz')).toBe('/');
    expect(sanitizeDeepLinkPath('/totally-unknown/xyz')).not.toBe('/orders');
    expect(resolveDeepLinkPath('https://www.sociva.in/#/totally-unknown/xyz')).toBe('/');
  });

  it('remaps dead campaign aliases to live routes', () => {
    expect(sanitizeDeepLinkPath('/marketplace')).toBe('/');
    expect(sanitizeDeepLinkPath('/offers')).toBe('/');
    expect(sanitizeDeepLinkPath('/bulletin')).toBe('/community');
    expect(sanitizeDeepLinkPath('/home')).toBe('/');
  });
});

describe('R3 marketplace rating/reviews/prep mapping without seller_profiles enrichment', () => {
  it('mapProduct carries RPC seller trust + prep + vacation + home-service', () => {
    const seller: RpcSellerRow = {
      seller_id: 's1',
      user_id: 'u1',
      business_name: 'Test Kitchen',
      description: null,
      categories: ['home_food'],
      primary_group: 'food_beverages',
      cover_image_url: null,
      profile_image_url: null,
      is_available: true,
      is_featured: true,
      rating: 4.7,
      total_reviews: 12,
      matching_products: [],
      distance_km: 0.8,
      society_name: 'Greenfield',
      availability_start: '09:00',
      availability_end: '21:00',
      seller_latitude: 12.9,
      seller_longitude: 77.6,
      operating_days: null,
      avg_response_minutes: 20,
      last_active_at: null,
      completed_order_count: 40,
      home_service_available: true,
      home_service_fee: 50,
      fulfillment_mode: 'delivery',
      vacation_mode: false,
      avg_preparation_time: 35,
    };
    const mapped = mapProduct(
      {
        id: 'p1',
        name: 'Biryani',
        price: 199,
        category: 'home_food',
        image_url: null,
        is_veg: true,
        is_available: true,
        action_type: 'add_to_cart',
      },
      seller,
    );
    expect(mapped.seller_rating).toBe(4.7);
    expect(mapped.seller_reviews).toBe(12);
    expect(mapped.avg_preparation_time).toBe(35);
    expect(mapped.seller_vacation_mode).toBe(false);
    expect(mapped.seller_home_service_available).toBe(true);
    expect(mapped.home_service_fee).toBe(50);
  });

  it('useMarketplaceData no longer round-trips seller_profiles for enrichment', () => {
    const src = read('src/hooks/queries/useMarketplaceData.ts');
    expect(src).not.toMatch(/from\('seller_profiles'\)/);
    expect(src).not.toMatch(/seller-home-service/);
    expect(src).toMatch(/home_service_available: s\.home_service_available === true/);
    expect(src).toMatch(/avg_preparation_time: s\.avg_preparation_time/);
    const mig = read('supabase/migrations/20261026233000_search_sellers_paginated_home_fields.sql');
    expect(mig).toMatch(/avg_preparation_time integer/);
    expect(mig).toMatch(/vacation_mode boolean/);
    expect(mig).toMatch(/home_service_available boolean/);
  });
});

describe('R4 Book/Contact mode action buckets', () => {
  it('buckets listings by resolved action into book and services', () => {
    const sellers = [
      {
        seller_id: 's1',
        matching_products: [
          { id: 'yoga', name: 'Yoga', category: 'yoga', action_type: 'book', price: 300 },
          { id: 'plumb', name: 'Leak', category: 'plumbing', action_type: 'request_quote', price: 1 },
          { id: 'food', name: 'Dal', category: 'home_food', action_type: 'add_to_cart', price: 120 },
        ],
      },
    ] as any;
    const buckets = bucketListingsByMode(sellers, [
      { category: 'yoga', transactionType: 'book_slot', behavior: { supportsCart: false, enquiryOnly: false } },
      { category: 'plumbing', transactionType: 'request_quote', behavior: { supportsCart: false, enquiryOnly: false } },
      { category: 'home_food', transactionType: 'cart_purchase', behavior: { supportsCart: true, enquiryOnly: false } },
    ] as any);
    expect(buckets.book.map((p) => p.id)).toContain('yoga');
    expect(buckets.services.map((p) => p.id)).toContain('plumb');
    expect(buckets.shop.map((p) => p.id)).toContain('food');
  });
});

describe('R5 orders auth ProtectedRoute parity', () => {
  it('wraps /orders, /orders/:id, and /seller/orders/:id with ProtectedRoute', () => {
    const app = read('src/App.tsx');
    expect(app).toMatch(
      /path="\/orders"\s+element=\{<ProtectedRoute>[\s\S]*?<OrdersPage/,
    );
    expect(app).toMatch(
      /path="\/orders\/:id"\s+element=\{<ProtectedRoute>[\s\S]*?<OrderDetailPage/,
    );
    expect(app).toMatch(
      /path="\/seller\/orders\/:id"\s+element=\{<ProtectedRoute>[\s\S]*?<OrderDetailPage/,
    );
  });

  it('session expiry paths store auth returnTo before #/auth', () => {
    const app = read('src/App.tsx');
    const auth = read('src/contexts/auth/useAuthState.ts');
    expect(app).toMatch(/setAuthReturnTo\(current\)/);
    expect(auth).toMatch(/setAuthReturnTo\(current\)/);
    expect(auth).toMatch(/event === 'SIGNED_OUT'/);
    expect(read('src/hooks/useAuthPage.ts')).toMatch(/consumeAuthReturnTo/);
  });
});

describe('R6 promotion / campaign notification defaults', () => {
  it('defaults promotion and campaign to home; food_discovery stays on food category', () => {
    expect(pickNotificationRoute({ type: 'promotion', payload: {} })).toBe('/');
    expect(pickNotificationRoute({ type: 'campaign', payload: {} })).toBe('/');
    expect(pickNotificationRoute({ type: 'food_discovery', payload: {} })).toBe(
      '/category/food_beverages',
    );
  });

  it('ignores vague reference_path for order types', () => {
    expect(
      pickNotificationRoute({
        type: 'order',
        reference_path: '/',
        payload: { order_id: 'ord-r6' },
      }),
    ).toBe('/orders/ord-r6');
  });
});

describe('R7 guest / guided / share / notify smoke', () => {
  it('guest browse allows book, services, and explore hubs', () => {
    expect(isGuestBrowsePath('/book')).toBe(true);
    expect(isGuestBrowsePath('/services')).toBe(true);
    expect(isGuestBrowsePath('/explore/home_food')).toBe(true);
    expect(isGuestBrowsePath('/orders')).toBe(false);
  });

  it('guided discovery hubs stay on /explore routes', () => {
    expect(guidedDiscoveryHubHref('home_food')).toBe('/explore/home_food');
    expect(guidedDiscoverySeeAllHref('home_food')).toMatch(/^\/(explore|category)\//);
  });

  it('campaign picker only offers live HashRouter screens', () => {
    const src = read('src/components/admin/campaign/CampaignDeepLinkPicker.tsx');
    expect(src).toContain("path: '/'");
    expect(src).toContain("path: '/community'");
    expect(src).not.toContain("path: '/marketplace'");
    expect(src).not.toContain("path: '/offers'");
    expect(src).not.toContain("path: '/bulletin'");
  });
});

describe('R8 device-link source contracts (no physical device)', () => {
  it('dinner hub App Link stays on explore, never /orders', () => {
    expect(
      resolveDeepLinkPath('https://www.sociva.in/#/explore/home_food?tile=meal:dinner'),
    ).toBe('/explore/home_food?tile=meal:dinner');
    expect(
      resolveDeepLinkPath('https://www.sociva.in/explore/home_food?tile=meal:dinner'),
    ).toBe('/explore/home_food?tile=meal:dinner');
  });

  it('product share OG URL maps to /product/:id', () => {
    const id = '144e18de-9443-4163-98a3-6365abe30ee2';
    expect(resolveDeepLinkPath(`https://www.sociva.in/api/share/product/${id}?og=1`)).toBe(
      `/product/${id}`,
    );
    expect(productShareUrl(id)).toContain(`/api/share/product/${id}`);
  });

  it('seller order push tap opens order route (selling tab via push handler)', () => {
    expect(
      pickNotificationRoute({
        type: 'order_created',
        payload: { order_id: 'ord-seller-1', target_role: 'seller' },
      }),
    ).toBe('/orders/ord-seller-1');
    expect(
      pickNotificationRoute({
        type: 'order',
        payload: { order_id: 'ord-seller-2' },
      }),
    ).toBe('/orders/ord-seller-2');
    const push = read('src/hooks/usePushNotifications.ts');
    expect(push).toMatch(/pickNotificationRoute/);
    expect(push).toMatch(/setPendingDeepLink\(route\)/);
    expect(push).toMatch(/tab: 'selling'/);
    expect(push).toMatch(/data\?\.type === 'order' \|\| data\?\.type === 'order_created'/);
  });

  it('Android App Links declare sociva.in hosts and sociva scheme', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:host="www.sociva.in"');
    expect(manifest).toContain('android:host="sociva.in"');
    expect(manifest).toContain('android:scheme="sociva"');
  });
});

describe('AUDIT-002 shell-load guards', () => {
  it('marketplace products keep placeholderData and 30m staleTime', () => {
    const products = read('src/hooks/queries/useMarketplaceProducts.ts');
    const sellers = read('src/hooks/queries/useMarketplaceSellers.ts');
    expect(products).toMatch(/placeholderData:\s*\(previous\)\s*=>\s*previous/);
    expect(products).toMatch(/jitteredStaleTime\(30 \* 60 \* 1000\)/);
    expect(sellers).toMatch(/jitteredStaleTime\(30 \* 60 \* 1000\)/);
  });

  it('Orders defers secondary cards and shows auth skeleton', () => {
    const orders = read('src/pages/OrdersPage.tsx');
    expect(orders).toMatch(/DeferredBuyerOrdersExtras/);
    expect(orders).toMatch(/orders-auth-skeleton/);
    expect(orders).toMatch(/orders-extras-deferred/);
    expect(orders).not.toMatch(/if \(!user\) return null/);
  });

  it('wallet and loyalty history fetch only when expanded', () => {
    const wallet = read('src/components/wallet/WalletCard.tsx');
    const loyalty = read('src/components/loyalty/LoyaltyCard.tsx');
    expect(wallet).toMatch(/useWalletHistory\(10,\s*\{\s*enabled:\s*showHistory\s*\}\)/);
    expect(loyalty).toMatch(/useLoyaltyHistory\(10,\s*\{\s*enabled:\s*showHistory\s*\}\)/);
  });

  it('prefetch prioritizes Orders and Account over Explore', () => {
    const src = read('src/lib/route-prefetch.ts');
    expect(src).toMatch(/prefetch\('orders'[\s\S]*?,\s*250\)/);
    expect(src).toMatch(/prefetch\('profile'[\s\S]*?,\s*350\)/);
    expect(src).toMatch(/prefetch\('explore'[\s\S]*?,\s*600\)/);
  });
});
