import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listingMatchesSearchText, stampSellerHoursFromInventory } from '@/lib/listing-search';

const read = (p: string) => readFileSync(resolve(process.cwd(), 'src', p), 'utf8');

describe('home Blinkit-style search', () => {
  it('filters the home product grid from the header query, not only a dropdown', () => {
    expect(read('components/layout/AppShell.tsx')).toMatch(/HomeSearchProvider/);
    expect(read('components/layout/Header.tsx')).toMatch(/useHomeSearch/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/useHomeSearch/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/useNearbyProductSearch/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/data-testid="home-search-results"/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/visibleSearchProducts/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/CommerceFacetRail/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/home-filtered-results/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/!isFacetFilterActive/);
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/facetParentGroup/);
    expect(read('components/home/MarketplaceSection.tsx')).not.toMatch(/\/search\?q=/);
    const bookContact = read('pages/CommerceModePage.tsx');
    expect(bookContact).toMatch(/searchActive/);
    expect(bookContact).toMatch(/!searchActive && bookTiles/);
    expect(bookContact).toMatch(/mode === 'book' && !searchActive/);
    expect(bookContact).toMatch(/data-testid=\{searchActive \? 'commerce-mode-search-results'/);
    const category = read('pages/CategoryGroupPage.tsx');
    expect(category).toMatch(/maxHeight=\{220\}/);
    expect(category).not.toMatch(/setSearchQuery\(''\);\s*setSearchOpen\(false\)/);
  });

  it('copies closed-store hours onto FTS search hits from the same seller', () => {
    const local = {
      id: 'veg-momos',
      seller_id: 'cafe-1',
      seller_availability_start: '10:00',
      seller_availability_end: '22:30',
      seller_operating_days: ['Mon'],
      seller_is_available: true,
      seller_vacation_mode: false,
    };
    const fts = { id: 'nonveg-momos', seller_id: 'cafe-1' };
    expect(stampSellerHoursFromInventory(fts, [local])).toMatchObject({
      id: 'nonveg-momos',
      seller_availability_start: '10:00',
      seller_availability_end: '22:30',
      seller_is_available: true,
    });
    expect(read('components/home/MarketplaceSection.tsx')).toMatch(/stampSellerHoursFromInventory/);
    expect(read('pages/CommerceModePage.tsx')).toMatch(/stampSellerHoursFromInventory/);
  });

  it('keeps matching listings when the typed name is in the title', () => {
    expect(listingMatchesSearchText({ name: 'Dragon Veg Momos - 5 pcs', seller_name: 'Cafe' }, 'momos')).toBe(true);
    expect(listingMatchesSearchText({ name: 'Baingan Bharta', seller_name: 'Tadka Ghar' }, 'momos')).toBe(false);
  });
});
