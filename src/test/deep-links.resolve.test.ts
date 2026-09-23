/**
 * Deep-link path normalization (HashRouter + App Links + sociva://)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { resolveDeepLinkPath } from '@/hooks/useDeepLinks';
import { isAppUpdatePath, storeUrlForPlatform } from '@/lib/app-update-link';
import { ANDROID_PLAY_STORE_URL, IOS_APP_STORE_URL } from '@/components/landing/LandingDownload';

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

  it('maps OG share product URLs to /product/:id (not /orders fallback)', () => {
    expect(
      resolveDeepLinkPath(
        'https://www.sociva.in/api/share/product/144e18de-9443-4163-98a3-6365abe30ee2?og=1',
      ),
    ).toBe('/product/144e18de-9443-4163-98a3-6365abe30ee2');
  });

  it('maps OG share store URLs to /seller/:id', () => {
    expect(resolveDeepLinkPath('https://www.sociva.in/api/share/store/abc-seller')).toBe(
      '/seller/abc-seller',
    );
  });

  it('keeps /update as the store link instead of an in-app route', () => {
    expect(resolveDeepLinkPath('https://sociva.in/update')).toBe('/update');
    expect(isAppUpdatePath(resolveDeepLinkPath('https://www.sociva.in/update/'))).toBe(true);
    expect(isAppUpdatePath('/update')).toBe(true);
    expect(isAppUpdatePath('/orders/1')).toBe(false);
    expect(storeUrlForPlatform('android')).toBe(ANDROID_PLAY_STORE_URL);
    expect(storeUrlForPlatform('ios')).toBe(IOS_APP_STORE_URL);
    const page = read('public/update/index.html');
    expect(page).toContain('id6759218504');
    expect(page).toContain('app.sociva.community');
    const links = read('src/hooks/useDeepLinks.ts');
    expect(links).toMatch(/isAppUpdatePath/);
    expect(links).toMatch(/Browser\.open/);
  });

  it('product deep-link sheet uses HashRouter location, not window.location.pathname', () => {
    const src = read('src/pages/ProductDeepLinkPage.tsx');
    expect(src).toMatch(/useLocation/);
    expect(src).toMatch(/const currentPath = location\.pathname/);
    expect(src).not.toMatch(/window\.location\.pathname/);
  });
});
