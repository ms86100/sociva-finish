import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('hardcore QA copy / dialog contracts', () => {
  it('ActionBlockedDialog dismisses via onOpenChange and clears on route change', () => {
    const src = read('src/components/feedback/ActionBlockedDialog.tsx');
    expect(src).toContain('clearNotifyQueue');
    expect(src).toContain('location.pathname');
    expect(src).toContain('onOpenChange');
    expect(src).toContain('acknowledgeNotify');
  });

  it('search empty state is domain-neutral', () => {
    const src = read('src/pages/SearchPage.tsx');
    expect(src).toContain('Nothing nearby matches this search yet.');
    expect(src).toContain('become the first to offer it');
    expect(src).not.toContain('Some services may not be available');
    expect(src).not.toContain('offer this service');
  });

  it('product sheet singularizes one review', () => {
    const src = read('src/components/product/ProductDetailSheet.tsx');
    expect(src).toMatch(/seller_reviews === 1 \? 'review' : 'reviews'/);
  });

  it('added-to-cart modal uses the rupee symbol', () => {
    const src = read('src/components/ui/CartAddPopup.tsx');
    expect(src).toContain('₹{price}');
    expect(src).not.toMatch(/Rs \{price\}/);
  });

  it('cart store row counts quantity, not SKU rows', () => {
    const src = read('src/pages/CartPage.tsx');
    expect(src).toContain('item.quantity');
    expect(src).not.toMatch(/group\.items\.length\} item\{group\.items\.length/);
  });

  it('header does not use society address while a browse pin override is active', () => {
    const src = read('src/components/layout/Header.tsx');
    expect(src).toContain('hasOverride');
    expect(src).toMatch(/!\s*hasOverride/);
  });
});
