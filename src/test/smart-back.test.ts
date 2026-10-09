import { describe, expect, it, beforeEach } from 'vitest';
import {
  isTabRootPath,
  shouldShowHeaderBack,
  recordNavigationPath,
  peekPreviousPath,
  resolveBackFallback,
  resetNavigationStackForTests,
  beginExternalEntry,
  planBackNavigation,
  consumeUntrustedPop,
  getNavigationStackForTests,
  toNavPath,
} from '@/lib/navigation-stack';
import { isJourneyBack, readSearchJourney, writeSearchJourney, searchJourneyKey } from '@/lib/search-journey';
import { defaultFilters } from '@/components/search/SearchFilters';

describe('navigation stack', () => {
  beforeEach(() => {
    resetNavigationStackForTests();
    sessionStorage.clear();
  });

  it('identifies tab roots', () => {
    expect(isTabRootPath('/profile')).toBe(true);
    expect(isTabRootPath('/seller')).toBe(false);
  });

  it('hides header back on tab roots by default', () => {
    expect(shouldShowHeaderBack('/profile')).toBe(false);
    expect(shouldShowHeaderBack('/seller/wallet')).toBe(true);
    expect(shouldShowHeaderBack('/profile', true)).toBe(true);
  });

  it('tracks meaningful previous paths', () => {
    recordNavigationPath('/home', 'REPLACE');
    recordNavigationPath('/seller/123', 'PUSH');
    recordNavigationPath('/seller/123/products', 'PUSH');
    expect(peekPreviousPath('/seller/123/products')).toBe('/seller/123');
  });

  it('resolves seller and order fallbacks', () => {
    expect(resolveBackFallback('/seller/wallet')).toBe('/seller');
    expect(resolveBackFallback('/seller')).toBe('/profile');
    expect(resolveBackFallback('/order/abc')).toBe('/orders');
    expect(resolveBackFallback('/orders/abc')).toBe('/orders');
    expect(resolveBackFallback('/profile/edit')).toBe('/profile');
    expect(resolveBackFallback('/seller/products/new')).toBe('/seller/products');
    expect(resolveBackFallback('/admin/stores/s1/products/p1/edit')).toBe('/admin/stores/s1/products');
    expect(resolveBackFallback('/admin/command-center')).toBe('/admin');
    expect(resolveBackFallback('/product/p1')).toBe('/');
  });

  it('unwinds a buyer journey without oscillating', () => {
    recordNavigationPath('/', 'REPLACE');
    recordNavigationPath('/search', 'PUSH');
    recordNavigationPath('/search', 'REPLACE', '?q=biryani');
    recordNavigationPath('/seller/tadka', 'PUSH');
    recordNavigationPath('/product/chicken', 'PUSH');

    expect(peekPreviousPath('/product/chicken')).toBe('/seller/tadka');
    expect(planBackNavigation('/product/chicken').type).toBe('history');

    recordNavigationPath('/seller/tadka', 'POP');
    expect(peekPreviousPath('/seller/tadka')).toBe('/search?q=biryani');
    expect(planBackNavigation('/seller/tadka').type).toBe('history');

    recordNavigationPath('/search', 'POP', '?q=biryani');
    expect(peekPreviousPath('/search?q=biryani')).toBe('/');
    expect(getNavigationStackForTests()).toEqual(['/', '/search?q=biryani']);
  });

  it('does not trust browser history for a shared product link', () => {
    recordNavigationPath('/seller/settings', 'PUSH');
    beginExternalEntry('/product/shared');
    recordNavigationPath('/product/shared', 'PUSH');
    expect(getNavigationStackForTests()).toEqual(['/product/shared']);
    expect(planBackNavigation('/product/shared', { fallback: '/' })).toEqual({ type: 'replace', to: '/' });
    expect(consumeUntrustedPop('/seller/settings')).toBe('/');
  });

  it('keeps the in-app store after a deep-linked product', () => {
    beginExternalEntry('/product/shared');
    recordNavigationPath('/product/shared', 'PUSH');
    recordNavigationPath('/seller/tadka', 'PUSH');
    expect(planBackNavigation('/seller/tadka').type).toBe('history');
    expect(peekPreviousPath('/seller/tadka')).toBe('/product/shared');
  });

  it('keeps search query text in the journey path', () => {
    expect(toNavPath('/search', '?q=biryani&sort=rating')).toBe('/search?q=biryani&sort=rating');
  });
});

describe('search journey snapshot', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('restores filters only for a back arrival', () => {
    expect(isJourneyBack('POP', null)).toBe(true);
    expect(isJourneyBack('REPLACE', { socivaBack: true })).toBe(true);
    expect(isJourneyBack('PUSH', null)).toBe(false);
    writeSearchJourney('biryani', {
      filters: { ...defaultFilters, sortBy: 'rating', minRating: 4 },
      selectedCategory: 'food',
    });
    expect(searchJourneyKey(' Biryani ')).toBe('biryani');
    expect(readSearchJourney('biryani')?.selectedCategory).toBe('food');
    expect(readSearchJourney('biryani')?.filters.sortBy).toBe('rating');
  });
});
