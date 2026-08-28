import { describe, expect, it, beforeEach } from 'vitest';
import {
  isTabRootPath,
  shouldShowHeaderBack,
  recordNavigationPath,
  peekPreviousPath,
  resolveBackFallback,
  resetNavigationStackForTests,
} from '@/lib/navigation-stack';

describe('navigation stack', () => {
  beforeEach(() => {
    resetNavigationStackForTests();
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
    expect(resolveBackFallback('/profile/edit')).toBe('/profile');
  });
});
