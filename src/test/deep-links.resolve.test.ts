/**
 * Deep-link path normalization (HashRouter + App Links + sociva://)
 */
import { describe, it, expect } from 'vitest';
import { resolveDeepLinkPath } from '@/hooks/useDeepLinks';

describe('resolveDeepLinkPath', () => {
  it('extracts HashRouter hash from https App Link', () => {
    expect(resolveDeepLinkPath('https://www.sociva.in/#/orders/abc')).toBe('/orders/abc');
  });

  it('uses pathname when hash is absent (Android Intent style)', () => {
    expect(resolveDeepLinkPath('https://www.sociva.in/orders/abc')).toBe('/orders/abc');
  });

  it('parses custom scheme sociva://host/path', () => {
    expect(resolveDeepLinkPath('sociva://orders/abc')).toBe('/orders/abc');
  });

  it('parses apex domain App Links', () => {
    expect(resolveDeepLinkPath('https://sociva.in/#/cart')).toBe('/cart');
  });
});
