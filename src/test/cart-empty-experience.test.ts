import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isCartItemsQueryRoute } from '@/hooks/useCart';
import {
  clearedCartSummary,
  emptyCartHeadline,
} from '@/lib/cleared-cart';

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

describe('empty cart after clear', () => {
  it('keeps a neighbourhood empty state with undo, not a generic explore dump', () => {
    const page = read('pages/CartPage.tsx');
    expect(page).toMatch(/CartEmptyExperience/);
    expect(page).toMatch(/saveClearedCartSnapshot/);
    expect(page).toMatch(/sellerId:/);
    expect(page).toMatch(/You can undo for a few minutes/);
    expect(page).not.toMatch(/Your cart is empty/);
    expect(page).not.toMatch(/Explore Marketplace/);
    expect(page).not.toMatch(/cannot be undone/);
    const empty = read('components/cart/CartEmptyExperience.tsx');
    expect(empty).toMatch(/Undo clear/);
    expect(empty).toMatch(/Quick picks/);
    expect(empty).toMatch(/Back to/);
    expect(empty).toMatch(/data-testid="cart-empty-experience"/);
  });

  it('writes a time-aware headline and a restore summary', () => {
    const night = new Date();
    night.setHours(0, 17, 0, 0);
    expect(emptyCartHeadline(night).title).toBe('Your bag is empty');
    expect(emptyCartHeadline(night).subtitle).toMatch(/scheduled orders for morning/);
    expect(emptyCartHeadline(night, { justCleared: true, sellerName: 'Biryani and Kebab' }).title)
      .toBe('Cleared Biryani and Kebab');
    expect(clearedCartSummary({
      at: Date.now(),
      sellerName: 'Mountain High Studio Cafe',
      sellerId: 'abc',
      itemCount: 1,
      lines: [],
    })).toBe('Removed 1 item from Mountain High Studio Cafe');
  });
});

describe('cart cache stays warm off the cart page', () => {
  it('keeps the cart JOIN query on seller dashboard, nested seller ops, profile, orders, book and contact', () => {
    expect(isCartItemsQueryRoute('/seller')).toBe(true);
    expect(isCartItemsQueryRoute('/seller/0a670c2b-f28a-4916-90cf-47fb1e9edbfa')).toBe(true);
    expect(isCartItemsQueryRoute('/seller/products/new')).toBe(true);
    expect(isCartItemsQueryRoute('/seller/orders/abc')).toBe(true);
    expect(isCartItemsQueryRoute('/profile')).toBe(true);
    expect(isCartItemsQueryRoute('/orders')).toBe(true);
    expect(isCartItemsQueryRoute('/book')).toBe(true);
    expect(isCartItemsQueryRoute('/services')).toBe(true);
    expect(isCartItemsQueryRoute('/cart')).toBe(true);
    expect(read('hooks/useCart.tsx')).toMatch(/placeholderData: \(previous\) => previous/);
    expect(read('hooks/useCartCount.ts')).toMatch(/refetchOnMount: 'always'/);
    expect(read('components/layout/Header.tsx')).toMatch(/isRecoveringCart/);
  });
});

describe('search overlay does not steal listing taps', () => {
  it('delays outside-pointer dismiss so the listing click still fires', () => {
    const search = read('components/search/SearchAutocomplete.tsx');
    expect(search).toMatch(/Delay so a listing tap under the overlay still receives click/);
    expect(search).toMatch(/setDismissedQuery\(trimmedRef\.current\)/);
  });

  it('lets feed taps pass through empty suggestion chrome while keeping suggestion rows clickable', () => {
    const search = read('components/search/SearchAutocomplete.tsx');
    expect(search).toMatch(/pointer-events-none absolute left-0 right-0 top-full/);
    expect(search).toMatch(/pointer-events-auto w-full flex items-center gap-3/);
  });
});

describe('Book/Contact empty search copy', () => {
  it('does not add a second Clear search control on empty results', () => {
    const page = read('pages/CommerceModePage.tsx');
    expect(page).toMatch(/Show all listings/);
    expect(page).not.toMatch(/>[\s]*Clear search[\s]*</);
    // Avoid native type=search clear + our X (two Clear search controls in a11y tree)
    expect(page).toMatch(/type="text"/);
    expect(page).not.toMatch(/type="search"/);
  });
});
