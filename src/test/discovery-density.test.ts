import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MIN_RAIL_CARDS,
  MIN_SECTION_LISTINGS,
  buildShopPosterSections,
  hasPosterDensity,
  hasRailDensity,
} from '@/lib/discovery-density';
import { buildDiscoveryIntents } from '@/lib/discovery-intents';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const n = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i) }));

const groups = [
  { category: 'snacks', parentGroup: 'food_beverages', products: n(1) },
  { category: 'restaurant', parentGroup: 'food_beverages', products: n(10) },
  { category: 'cafe', parentGroup: 'food_beverages', products: n(50) },
  { category: 'home_food', parentGroup: 'food_beverages', products: n(29) },
];

describe('discovery density', () => {
  it('needs 3 listings for a poster and 2 cards for a rail', () => {
    expect(MIN_SECTION_LISTINGS).toBe(3);
    expect(MIN_RAIL_CARDS).toBe(2);
    expect(hasPosterDensity(1)).toBe(false);
    expect(hasPosterDensity(2)).toBe(false);
    expect(hasPosterDensity(3)).toBe(true);
    expect(hasRailDensity(1)).toBe(false);
    expect(hasRailDensity(2)).toBe(true);
  });

  it('never builds Home category poster rows, even for dense leaves', () => {
    const sections = buildShopPosterSections(groups, {
      titleFor: (category) => category,
    });
    expect(sections).toEqual([]);
  });

  it('chip rail still lists a live 1-item Snacks category', () => {
    const intents = buildDiscoveryIntents([{
      category: 'snacks',
      parentGroup: 'food_beverages',
      displayName: 'Snacks',
      icon: 'Cookie',
      products: [{ id: 'm1', name: 'madhubani makhana', image_url: 'https://img/makhana.jpg' }],
    }]);
    expect(intents.find((intent) => intent.id === 'cat:snacks')?.count).toBe(1);
  });

  it('Home drops category posters and keeps chip plus rail density', () => {
    const home = read('src/components/home/MarketplaceSection.tsx');
    const rail = read('src/components/discovery/IntentProductRail.tsx');
    const sellers = read('src/components/home/GroupedSellerRow.tsx');
    const festival = read('src/components/home/FestivalBannerModule.tsx');
    expect(home).not.toMatch(/CategoryImageGrid/);
    expect(home).not.toMatch(/buildShopPosterSections/);
    expect(home).toMatch(/buildDiscoveryIntents\(localCategoriesWithFacets/);
    expect(rail).toMatch(/hasRailDensity\(products\.length\)/);
    expect(sellers).toMatch(/minSellers = MIN_RAIL_CARDS/);
    expect(festival).toMatch(/minSellers=\{1\}/);
  });
});
