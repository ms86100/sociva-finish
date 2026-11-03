import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'src');

function read(rel: string) {
  return readFileSync(join(root, rel), 'utf8');
}

describe('Phase 1.1 motion regression contracts', () => {
  it('shows content-aware skeleton while marketplace is loading', () => {
    const src = read('components/home/MarketplaceSection.tsx');
    expect(src).toMatch(/marketplaceStatus === 'loading'/);
    expect(src).toMatch(/marketplace-status-loading/);
    expect(src).toMatch(/ProductGridSkeleton/);
  });

  it('gates base Skeleton shimmer under reduced motion', () => {
    const skeleton = read('components/ui/skeleton.tsx');
    const css = read('index.css');
    expect(skeleton).toMatch(/motion-safe:animate-\[shimmer/);
    expect(css).toMatch(/\[data-skeleton\] > div/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });

  it('avoids nested cardEntrance wrappers around ProductListingCard', () => {
    for (const file of [
      'pages/CommerceModePage.tsx',
      'pages/CategoryGroupPage.tsx',
      'components/home/MarketplaceSection.tsx',
      'pages/SearchPage.tsx',
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/motion\.div key=\{product\.id\} variants=\{cardEntrance\}/);
      expect(src).not.toMatch(/motion\.div key=\{p\.product_id\} variants=\{cardEntrance\}/);
    }
  });

  it('keeps OrderSuccessOverlay success-gated', () => {
    const overlay = read('components/checkout/OrderSuccessOverlay.tsx');
    const orderDetail = read('pages/OrderDetailPage.tsx');
    expect(overlay).toMatch(/real checkout/i);
    expect(orderDetail).toMatch(/fromCheckout/);
    expect(orderDetail).toMatch(/OrderSuccessOverlay/);
  });
});
