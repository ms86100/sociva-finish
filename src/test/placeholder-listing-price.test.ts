import { describe, expect, it } from 'vitest';
import { filterByMode, isPlaceholderBookListing, isPlaceholderListingPrice } from '@/lib/commerce-mode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('placeholder Book listing prices', () => {
  it('treats positive stub prices at or below ₹1 as placeholders, keeps free ₹0', () => {
    expect(isPlaceholderListingPrice(1)).toBe(true);
    expect(isPlaceholderListingPrice(1.0)).toBe(true);
    expect(isPlaceholderListingPrice(0)).toBe(false);
    expect(isPlaceholderListingPrice(99)).toBe(false);
    expect(isPlaceholderListingPrice(null)).toBe(false);
  });

  it('also hides free rows that advertise a ₹1 placeholder in copy', () => {
    expect(isPlaceholderBookListing({
      price: 0,
      name: 'Acne Treatment',
      description: 'Price placeholder ₹1; seller will update.',
    })).toBe(true);
    expect(isPlaceholderBookListing({
      price: 0,
      name: 'FREE Dental Consultation',
      description: 'Complimentary consult with the dentist.',
    })).toBe(false);
  });

  it('drops stubs from Book mode filters while keeping Contact/shop rows', () => {
    const rows = [
      { id: 'a', action_type: 'book', category: 'salon', price: 1, name: 'Lippan' },
      { id: 'b', action_type: 'book', category: 'salon', price: 0, name: 'Free consult', description: 'Walk in' },
      { id: 'c', action_type: 'book', category: 'salon', price: 0, name: 'Acne', description: 'Price placeholder ₹1; seller will update.' },
      { id: 'd', action_type: 'book', category: 'salon', price: 499, name: 'Haircut' },
      { id: 'e', action_type: 'add_to_cart', category: 'home_food', price: 1, name: 'Snack' },
    ];
    const book = filterByMode(rows, 'book');
    expect(book.map((r) => r.id)).toEqual(['b', 'd']);
    expect(filterByMode(rows, 'shop').map((r) => r.id)).toEqual(['e']);
  });

  it('commerce mode buckets skip placeholder Book listings', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/hooks/queries/useCommerceModeListings.ts'), 'utf8');
    expect(src).toMatch(/isPlaceholderBookListing\(raw\)/);
    expect(src).toMatch(/mode === 'book'/);
    const market = readFileSync(resolve(process.cwd(), 'src/hooks/queries/useMarketplaceData.ts'), 'utf8');
    expect(market).toMatch(/description: p\.description/);
  });
});
