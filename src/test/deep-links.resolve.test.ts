/**
 * Deep-link path normalization (HashRouter + App Links + sociva://)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveDeepLinkPath } from '@/hooks/useDeepLinks';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

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

  it('product deep-link sheet uses HashRouter location, not window.location.pathname', () => {
    const src = read('src/pages/ProductDeepLinkPage.tsx');
    expect(src).toMatch(/useLocation/);
    expect(src).toMatch(/const currentPath = location\.pathname/);
    expect(src).not.toMatch(/window\.location\.pathname/);
  });
});
