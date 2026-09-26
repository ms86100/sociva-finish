import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isGuestBrowsePath, authReturnPath } from '@/lib/guest-browse-routes';
import {
  isLocationOnboardingDone,
  markLocationOnboardingDone,
  needsLocationOnboarding,
} from '@/lib/location-onboarding';
import {
  setPendingAuthAction,
  peekPendingAuthAction,
  takePendingAuthAction,
  clearPendingAuthAction,
  resolvePendingReturnTo,
  pendingAuthReturnPath,
  resolveAfterOnboardingPath,
  profileEditOnboardingState,
} from '@/lib/pending-auth-action';
import {
  clearGuestCart,
  guestCartItemCount,
  readGuestCart,
  upsertGuestCartItem,
  writeGuestCart,
} from '@/lib/guest-cart';
import type { Product } from '@/types/Database';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

const fakeProduct = {
  id: 'p1',
  name: 'Test Item',
  price: 100,
  image_url: null,
  seller_id: 's1',
  action_type: 'add_to_cart',
  accepts_preorders: false,
} as unknown as Product;

describe('guest browse allow-list', () => {
  it('allows discovery paths, cart, and seller storefront only', () => {
    expect(isGuestBrowsePath('/')).toBe(true);
    expect(isGuestBrowsePath('/search')).toBe(true);
    expect(isGuestBrowsePath('/categories')).toBe(true);
    expect(isGuestBrowsePath('/discover-location')).toBe(true);
    expect(isGuestBrowsePath('/cart')).toBe(true);
    expect(isGuestBrowsePath('/category/food')).toBe(true);
    expect(isGuestBrowsePath('/discovery/nearby')).toBe(true);
    expect(isGuestBrowsePath('/product/abc')).toBe(true);
    expect(isGuestBrowsePath('/festival-collection/diwali')).toBe(true);
    expect(isGuestBrowsePath('/seller/store-uuid')).toBe(true);
    expect(isGuestBrowsePath('/seller/store-uuid/')).toBe(true);

    expect(isGuestBrowsePath('/orders')).toBe(false);
    expect(isGuestBrowsePath('/profile')).toBe(false);
    expect(isGuestBrowsePath('/seller/products')).toBe(false);
    expect(isGuestBrowsePath('/admin')).toBe(false);
  });

  it('preserves return path for auth redirect', () => {
    expect(authReturnPath('/product/x', '?q=1')).toBe('/product/x?q=1');
  });
});

describe('location onboarding gate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('skips when coords already exist', () => {
    expect(needsLocationOnboarding(true)).toBe(false);
  });

  it('requires onboarding until marked done', () => {
    expect(isLocationOnboardingDone()).toBe(false);
    expect(needsLocationOnboarding(false)).toBe(true);
    markLocationOnboardingDone();
    expect(isLocationOnboardingDone()).toBe(true);
    expect(needsLocationOnboarding(false)).toBe(false);
  });
});

describe('pending auth action storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
    clearPendingAuthAction();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('round-trips checkout and clears on take', () => {
    setPendingAuthAction({ type: 'checkout', returnTo: '/cart' });
    expect(peekPendingAuthAction()?.type).toBe('checkout');
    expect(resolvePendingReturnTo({ type: 'checkout' }, '/')).toBe('/cart');
    expect(pendingAuthReturnPath('/')).toBe('/cart');
    const taken = takePendingAuthAction();
    expect(taken?.type).toBe('checkout');
    expect(peekPendingAuthAction()).toBeNull();
  });

  it('round-trips book draft with date and time', () => {
    setPendingAuthAction({
      type: 'book',
      productId: 'svc1',
      returnTo: '/product/svc1',
      bookingDraft: { date: '2026-09-25', time: '10:00', step: 'review' },
    });
    const pending = peekPendingAuthAction();
    expect(pending?.type).toBe('book');
    expect(pending && pending.type === 'book' ? pending.bookingDraft?.date : null).toBe('2026-09-25');
    expect(pending && pending.type === 'book' ? pending.bookingDraft?.time : null).toBe('10:00');
    expect(resolvePendingReturnTo(pending!, '/')).toBe('/product/svc1');
  });

  it('resolves return path from product id', () => {
    expect(
      resolvePendingReturnTo({ type: 'enquire', productId: 'abc' }, '/'),
    ).toBe('/product/abc');
    expect(pendingAuthReturnPath('/')).toBe('/');
    setPendingAuthAction({ type: 'book', productId: 'z', returnTo: '/product/z' });
    expect(pendingAuthReturnPath('/')).toBe('/product/z');
  });

  it('after onboarding: cart intent wins over home', () => {
    clearPendingAuthAction();
    expect(resolveAfterOnboardingPath({ itemCount: 0 })).toBe('/');
    expect(resolveAfterOnboardingPath({ itemCount: 2 })).toBe('/cart');
    setPendingAuthAction({ type: 'checkout', returnTo: '/cart' });
    expect(resolveAfterOnboardingPath({ itemCount: 0 })).toBe('/cart');
    expect(resolveAfterOnboardingPath({ locationReturnTo: '/cart', itemCount: 0 })).toBe('/cart');
    expect(resolveAfterOnboardingPath({ locationReturnTo: '/profile/edit', itemCount: 1 })).toBe('/cart');
    expect(profileEditOnboardingState({ itemCount: 1 }).returnTo).toBe('/cart');
    clearPendingAuthAction();
    expect(profileEditOnboardingState({ itemCount: 0 }).returnTo).toBeUndefined();
  });
});

describe('guest local cart', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGuestCart();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('persists add and counts items without auth', () => {
    upsertGuestCartItem(fakeProduct, 2);
    expect(guestCartItemCount()).toBe(2);
    expect(readGuestCart()[0]?.product_id).toBe('p1');
    writeGuestCart([]);
    expect(guestCartItemCount()).toBe(0);
  });
});

describe('guest location discovery wiring (source)', () => {
  it('sends website product browse to the marketing landing page', () => {
    const shell = read('components/layout/AppShell.tsx');
    expect(shell).toMatch(/isGuestBrowsePath/);
    expect(shell).toMatch(/isNativePlatform/);
    expect(shell).toMatch(/Navigate to="\/landing"/);
    expect(shell).toMatch(/needsLocationOnboarding/);
  });

  it('exposes cart as a public guest route', () => {
    const app = read('App.tsx');
    const bottomNav = read('components/layout/BottomNav.tsx');
    const header = read('components/layout/Header.tsx');
    expect(app).toMatch(/LocationDiscoveryPage/);
    expect(app).toMatch(/path="\/cart"/);
    expect(app).not.toMatch(/path="\/cart"[^>]*ProtectedRoute/);
    expect(bottomNav).toMatch(/GUEST_AUTH_ROUTES/);
    expect(bottomNav).toMatch(/to: '\/cart'/);
    expect(header).toMatch(/Available near you/);
    expect(header).toMatch(/Sign in/);
  });

  it('allows guest add-to-cart locally and gates OTP at Place Order / enquire / book / contact', () => {
    const cart = read('hooks/useCart.tsx');
    const cartPage = read('pages/CartPage.tsx');
    const enquiry = read('components/product/ProductEnquirySheet.tsx');
    const booking = read('components/booking/ServiceBookingFlow.tsx');
    const contact = read('components/product/ContactSellerModal.tsx');
    expect(cart).toMatch(/upsertGuestCartItem/);
    expect(cart).not.toMatch(/Sign in to add items to cart/);
    expect(cartPage).toMatch(/Where should we deliver\?/);
    expect(cartPage).toMatch(/type: 'checkout'/);
    expect(cartPage).toMatch(/returnTo: '\/cart'/);
    expect(enquiry).toMatch(/setPendingAuthAction/);
    expect(booking).toMatch(/type: 'book'/);
    expect(booking).toMatch(/bookingDraft/);
    expect(contact).toMatch(/type: 'contact'/);
  });

  it('uses discovery-first When In Use location copy', () => {
    const cap = readFileSync(resolve(__dirname, '../../capacitor.config.ts'), 'utf8');
    expect(cap).toMatch(/available near you/);
    expect(cap).toMatch(/NSLocationWhenInUseUsageDescription/);
  });

  it('asks permission, never falls back to Bangalore, and opens manual Places search', () => {
    const page = read('pages/LocationDiscoveryPage.tsx');
    const native = read('lib/native-location.ts');
    const map = read('components/auth/GoogleMapConfirm.tsx');
    const manual = read('components/location/DiscoveryManualSearch.tsx');
    const hero = read('components/location/DiscoveryMomentHero.tsx');
    const empty = read('components/location/DiscoveryEmptyPanel.tsx');

    expect(native).toMatch(/requestPermissions/);
    expect(native).toMatch(/permission_denied/);
    expect(page).toMatch(/requestPermission:\s*true/);
    expect(page).toMatch(/DiscoveryManualSearch/);
    expect(page).toMatch(/step === 'manual'/);
    expect(page).not.toMatch(/12\.9716/);
    expect(page).not.toMatch(/77\.5946/);
    expect(page).toMatch(/confirmingRef/);
    expect(map).toMatch(/submittedRef/);
    expect(map).toMatch(/confirming/);
    expect(map).toMatch(/\[latitude, longitude\]/);
    expect(manual).toMatch(/useAutocomplete/);
    expect(hero).toMatch(/Your Community Marketplace/);
    expect(hero).not.toMatch(/Popular near/);
    expect(empty).toMatch(/onSelectManual/);
    expect(empty).toMatch(/Explore categories/);
  });
});
