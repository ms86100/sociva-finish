import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assignFoodMenuSection,
  buildFoodMenuSections,
  foodMenuSectionAnchorId,
  FOOD_MENU_MORE_SECTION_ID,
} from '@/lib/food-menu-sections';

describe('food menu sections', () => {
  it('assigns meal before course and cuisine', () => {
    expect(
      assignFoodMenuSection({
        name: 'Idli',
        tags: ['meal:breakfast', 'course:main', 'cuisine:south_indian'],
      }),
    ).toBe('breakfast');
  });

  it('assigns course when meal is absent', () => {
    expect(
      assignFoodMenuSection({
        name: 'Soup',
        tags: ['course:appetizer', 'cuisine:chinese'],
      }),
    ).toBe('appetizer');
  });

  it('assigns cuisine when meal and course are absent', () => {
    expect(
      assignFoodMenuSection({
        name: 'Noodles',
        tags: ['cuisine:chinese'],
      }),
    ).toBe('chinese');
  });

  it('falls back to More with no facets', () => {
    expect(assignFoodMenuSection({ name: 'Mystery Bowl', tags: [] })).toBe(
      FOOD_MENU_MORE_SECTION_ID,
    );
  });

  it('keeps explicit course tag over name-hint meal (starters stay starters)', () => {
    // Name "biryani" would infer meal:lunch; tagged starter must not move
    expect(
      assignFoodMenuSection({
        name: 'Chicken Biryani Starter Bowl',
        tags: ['course:appetizer'],
      }),
    ).toBe('appetizer');
  });

  it('keeps explicit meal tag over conflicting name hints', () => {
    // "paratha" would infer breakfast; dinner tag must win
    expect(
      assignFoodMenuSection({
        name: 'Aloo Paratha Dinner Plate',
        tags: ['meal:dinner'],
      }),
    ).toBe('dinner');
  });

  it('uses name hints only when tags are absent', () => {
    expect(assignFoodMenuSection({ name: 'Masala Dosa', tags: [] })).toBe('breakfast');
    expect(assignFoodMenuSection({ name: 'Tomato Soup', tags: [] })).toBe('appetizer');
  });

  it('builds ordered non-empty sections with single placement', () => {
    const products = [
      { id: '1', name: 'Poha', tags: ['meal:breakfast'] },
      { id: '2', name: 'North Thali', tags: ['meal:lunch', 'cuisine:north_indian'] },
      { id: '3', name: 'Spring Roll', tags: ['course:appetizer'] },
      { id: '4', name: 'Dragon Noodles', tags: ['cuisine:chinese'] },
      { id: '5', name: 'House Special', tags: [] },
    ];

    const sections = buildFoodMenuSections(products);
    expect(sections.map((s) => s.id)).toEqual([
      'breakfast',
      'lunch',
      'chinese',
      'appetizer',
      FOOD_MENU_MORE_SECTION_ID,
    ]);

    const placedIds = sections.flatMap((s) => s.products.map((p) => p.id));
    expect(placedIds).toEqual(['1', '2', '4', '3', '5']);
    expect(new Set(placedIds).size).toBe(products.length);

    // North Indian lunch item stays under lunch, not north_indian
    expect(sections.find((s) => s.id === 'lunch')?.products.map((p) => p.id)).toEqual(['2']);
    expect(sections.find((s) => s.id === 'north_indian')).toBeUndefined();

    // Each section only holds its own items
    expect(sections.find((s) => s.id === 'breakfast')?.products.map((p) => p.id)).toEqual(['1']);
    expect(sections.find((s) => s.id === 'appetizer')?.products.map((p) => p.id)).toEqual(['3']);
  });

  it('drops empty sections and exposes seller-food anchors', () => {
    const sections = buildFoodMenuSections([
      { id: '1', name: 'Momos', tags: ['cuisine:chinese'] },
    ]);
    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('chinese');
    expect(foodMenuSectionAnchorId(sections[0].id)).toBe('seller-food-chinese');
  });

  it('veg-style shrink of the list does not change assignment rules', () => {
    const all = [
      { id: 'veg-bf', name: 'Poha', tags: ['meal:breakfast'], is_veg: true },
      { id: 'nv-din', name: 'Chicken Curry', tags: ['meal:dinner'], is_veg: false },
    ];
    const vegOnly = all.filter((p) => p.is_veg);
    const sections = buildFoodMenuSections(vegOnly);
    expect(sections.map((s) => s.id)).toEqual(['breakfast']);
    expect(assignFoodMenuSection(all[1])).toBe('dinner');
  });

  it('SellerDetailPage wires food sections, All chip, one-tap select, and scroll-spy without food list remount key', () => {
    const page = readFileSync(resolve(__dirname, '../pages/SellerDetailPage.tsx'), 'utf8');
    expect(page).toContain("from '@/lib/food-menu-sections'");
    expect(page).toContain('buildFoodMenuSections');
    expect(page).toContain('foodMenuSectionAnchorId');
    expect(page).toContain('IntersectionObserver');
    expect(page).toContain('scroll-mt-14');
    expect(page).toContain('data-food-section-chip');
    expect(page).toContain('data-food-section-chip="all"');
    expect(page).toContain('moods={[]}');
    expect(page).toContain('selectFoodSectionFilter');
    expect(page).toContain('clearFoodSectionFilter');
    expect(page).toContain('visibleFoodMenuSections');
    expect(page).toContain('activeFoodSectionId');
    expect(page).not.toContain('toggleFoodSectionFilter');
    expect(page).not.toContain('scrollToFoodSection');
    // Chip green follows active filter only - not scroll-spy highlight toggle
    expect(page).toContain('activeFoodSectionId === section.id');
    expect(page).toContain('activeFoodSectionId === null');
    expect(page).not.toContain('highlightedFoodSectionId === section.id');
    expect(page).toMatch(/isFoodStore \? \(/);
    const start = page.indexOf('isFoodStore ? (');
    const end = page.indexOf(') : (', start);
    const foodBranch = page.slice(start, end > start ? end : start + 800);
    expect(foodBranch).toContain('visibleFoodMenuSections.map');
    expect(foodBranch).not.toMatch(/key=\{activeCategory\}/);
  });
});
