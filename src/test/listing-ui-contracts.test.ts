/**
 * Listing / marketplace UI contracts - guards against spacing & data regressions.
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
    expect(src).toMatch(/from 'lucide-react'/);
    expect(src).toMatch(/Search/);
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
      expect(src).toContain('grid-cols-3');
      expect(src).toMatch(/gap-2(?:\.5)? sm:gap-3(?:\.5)?/);
    }
  });

  it('ProductListingCard keeps ADD clear of image with glass density', () => {
    const src = readSrc('src/components/product/ProductListingCard.tsx');
    expect(src).toContain('object-cover object-center');
    expect(src).toContain('never covers the dish');
    expect(src).toContain('product-image-shimmer');
    expect(src).toContain('glass-card');
    expect(src).toContain('SellerLocationLine');
    expect(src).toContain('listingPlaceChip');
    expect(src).not.toContain('Neighbor');
  });

  it('ProductListingCard collapses empty glance; reserves title only', () => {
    const src = readSrc('src/components/product/ProductListingCard.tsx');
    expect(src).toContain('data-slot="listing-price-group"');
    expect(src).toContain('data-slot="listing-glance"');
    expect(src).toContain('data-slot="listing-title"');
    expect(src).toContain('data-slot="listing-footer"');
    expect(src).toContain('data-slot="listing-store"');
    expect(src).toContain('data-slot="listing-location"');
    // Title keeps 2-line reserved height for store/location alignment across cards
    expect(src).toContain('h-[2.4em]');
    // Glance must be conditional - never a fixed empty height band between price and title
    expect(src).toMatch(/glanceFacts\.length\s*>\s*0\s*&&\s*\(\s*<div[^>]*data-slot="listing-glance"/);
    expect(src).not.toMatch(/data-slot="listing-glance"[^>]*h-\[/);
    expect(src).not.toMatch(/h-\[[^\]]+\][^>]*data-slot="listing-glance"/);
    expect(src).not.toMatch(/opacity-0[\s\S]{0,80}Serves/);
    // Compact stacked rhythm: no floating empty band between title and store
    expect(src).not.toMatch(/listing-footer[\s\S]{0,80}mt-auto/);
    expect(src).toContain('no mt-auto empty band');
    // Dense listing body must not inject variable-height trust / delivery rows
    const nonCompact = src.split(') : (')[1] || src;
    expect(nonCompact).not.toContain('StockLeftBattery');
    expect(nonCompact).not.toContain('deliveryText');
    expect(nonCompact).not.toContain('Only {product.stock_quantity} left');
  });

  it('ProductCard menu row keeps ADD below image without overlap', () => {
    const src = readSrc('src/components/product/ProductCard.tsx');
    expect(src).toContain('object-cover object-center');
    expect(src).not.toContain('-mt-4');
    expect(src).toContain('backdrop-blur-md');
  });

  it('imageHelpers scales by width only so CSS cover never stretches', () => {
    const src = readSrc('src/utils/imageHelpers.ts');
    expect(src).toContain('Width-only keeps the native aspect ratio');
    expect(src).not.toMatch(/height=\$\{/);
    expect(src).not.toContain('resize=');
  });

  it('listingPlaceChip drops tower/phase tails for dense cards', async () => {
    const { listingPlaceChip } = await import('@/lib/location-label-resolver');
    expect(listingPlaceChip('Shriram Greenfield Phase-2, Tower H')).toBe('Shriram Greenfield');
    expect(listingPlaceChip('Green Valley')).toBe('Green Valley');
  });

  it('price history shows a min-max range instead of a slant chart', () => {
    const src = readSrc('src/components/product/PriceHistoryChart.tsx');
    expect(src).toContain('Price range');
    expect(src).not.toContain('LineChart');
  });
});
