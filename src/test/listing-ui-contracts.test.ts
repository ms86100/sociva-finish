/**
 * Listing / marketplace UI contracts — guards against spacing & data regressions.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

function readSrc(rel: string) {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('marketplace listing UI contracts', () => {
  it('SellerCard Link root is block so vertical gap/stacking works', () => {
    const src = readSrc('src/components/seller/SellerCard.tsx');
    expect(src).toMatch(/className="[^"]*\bblock\b[^"]*"/);
    expect(src).toContain('group/seller');
  });

  it('CategoryGroupPage uses marketplace-stack for Top Sellers', () => {
    const src = readSrc('src/pages/CategoryGroupPage.tsx');
    expect(src).toContain('marketplace-stack');
    expect(src).not.toMatch(/Top Sellers[\s\S]{0,400}space-y-3/);
  });

  it('Top Sellers mapping preserves trust + price fields from marketplace data', () => {
    const src = readSrc('src/pages/CategoryGroupPage.tsx');
    expect(src).toContain('avg_response_minutes');
    expect(src).toContain('completed_order_count');
    expect(src).toContain('last_active_at');
    expect(src).toContain('description: s.description');
    expect(src).toMatch(/products:\s*categoryProducts/);
  });

  it('index.css defines marketplace-stack with flex gap (not space-y)', () => {
    const css = readSrc('src/index.css');
    expect(css).toMatch(/\.marketplace-stack\s*\{[^}]*flex flex-col gap-4/);
  });

  it('primary listing grids share elevated gap tokens', () => {
    const discovery = readSrc('src/pages/DiscoveryListingsPage.tsx');
    const category = readSrc('src/pages/CategoryGroupPage.tsx');
    const search = readSrc('src/pages/SearchPage.tsx');
    for (const src of [discovery, category, search]) {
      expect(src).toContain('gap-3 sm:gap-3.5');
    }
  });

  it('ProductListingCard keeps overlapping ADD clear of image edge', () => {
    const src = readSrc('src/components/product/ProductListingCard.tsx');
    expect(src).toContain('-bottom-4 right-2');
    expect(src).toContain('product-image-shimmer');
    expect(src).toContain('shadow-card');
  });
});
