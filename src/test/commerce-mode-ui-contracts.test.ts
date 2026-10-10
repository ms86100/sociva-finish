import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

describe('commerce-mode UI contracts', () => {
  it('buyer cards resolve their CTA through the shared resolver, not a raw add_to_cart default', () => {
    for (const file of [
      'components/product/ProductCard.tsx',
      'components/listing/ListingCard.tsx',
      'components/home/RichSellerCard.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toMatch(/resolveListingAction\(/);
      expect(src, file).not.toMatch(/action_type as ProductActionType\) \|\| 'add_to_cart'/);
    }
  });

  it('home and discovery surfaces classify by the shared resolver', () => {
    expect(read('components/home/BuyAgainRow.tsx')).toMatch(/resolveCommerceMode\(/);
    expect(read('components/location/DiscoveryMomentHero.tsx')).toMatch(/resolveCommerceMode\(/);
    expect(read('components/search/SearchAutocomplete.tsx')).toMatch(/suggestionIntent\(product, categoryConfigs\)/);
    for (const file of [
      'components/home/MarketplaceSection.tsx',
      'pages/CategoryGroupPage.tsx',
      'pages/DiscoveryListingsPage.tsx',
    ]) {
      expect(read(file), file).toMatch(/categoryConfigs/);
    }
  });

  it('header exposes a cart entry with a live count for guests and signed-in users', () => {
    const header = read('components/layout/Header.tsx');
    expect(header).toMatch(/useCartCount\(\)/);
    expect(header).toMatch(/handleRouteNav\('\/cart'\)/);
    expect(header).toMatch(/data-testid="header-cart"/);
    expect(header).toMatch(/location\.pathname !== '\/cart'/);
    const cartBlock = header.slice(header.indexOf('showCartButton && ('), header.indexOf('{!user ? ('));
    expect(cartBlock.length).toBeGreaterThan(0);
  });

  it('Society stays reachable from Profile via the same visibility rule as BottomNav', () => {
    const profile = read('pages/ProfilePage.tsx');
    const nav = read('components/layout/BottomNav.tsx');
    expect(profile).toMatch(/useSocietyEntryVisible\(\)/);
    expect(profile).toMatch(/label: 'My Society', to: '\/society'/);
    expect(nav).toMatch(/useSocietyEntryVisible\(\)/);
  });

  it('respects the OS reduced-motion preference app-wide', () => {
    expect(read('App.tsx')).toMatch(/<MotionConfig reducedMotion="user">/);
  });

  it('design tokens: mode colors, offer, motion and a self-hosted display font', () => {
    const css = read('index.css');
    for (const token of ['--mode-shop', '--mode-book', '--mode-services', '--offer', '--dur-micro', '--dur-macro', '--ease-standard']) {
      expect(css, token).toMatch(new RegExp(`${token}:`));
    }
    expect(css).toMatch(/font-family: 'Plus Jakarta Sans'/);
    expect(css).toMatch(/url\('\/fonts\/plus-jakarta-sans-latin-wght\.woff2'\)/);
    expect(css).toMatch(/font-display: swap/);
    const fonts = resolve(process.cwd(), 'public/fonts');
    expect(readFileSync(resolve(fonts, 'plus-jakarta-sans-latin-wght.woff2')).subarray(0, 4).toString('latin1')).toBe('wOF2');
    expect(readFileSync(resolve(fonts, 'PlusJakartaSans-OFL.txt'), 'utf8')).toMatch(/SIL Open Font License/);
  });
});
