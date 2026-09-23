import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  CATEGORY_PHOTO_CHIP_TOKENS,
  buildLeafPhotoChipItems,
} from '@/components/category/CategoryPhotoChipRail';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');

describe('category photo chip consistency', () => {
  it('exports a shared round-photo chip rail with locked tokens', () => {
    const rail = read('components/category/CategoryPhotoChipRail.tsx');
    expect(rail).toMatch(/export function CategoryPhotoChipRail/);
    expect(rail).toMatch(/export const CATEGORY_PHOTO_CHIP_TOKENS/);
    expect(rail).toMatch(/export function buildLeafPhotoChipItems/);
    expect(rail).toMatch(/rounded-full/);
    expect(rail).toMatch(/rounded-2xl/);
    expect(rail).toMatch(/flex flex-col items-center/);
    expect(rail).toMatch(/imageUrl/);
    expect(rail).toContain(CATEGORY_PHOTO_CHIP_TOKENS.button);
    expect(rail).toContain(CATEGORY_PHOTO_CHIP_TOKENS.photo);
    expect(rail).toContain(CATEGORY_PHOTO_CHIP_TOKENS.label);
    expect(rail).toContain(CATEGORY_PHOTO_CHIP_TOKENS.buttonActive);
    expect(rail).toContain(CATEGORY_PHOTO_CHIP_TOKENS.buttonInactive);
  });

  it('buildLeafPhotoChipItems uses leaf display names, not parent groups', () => {
    const items = buildLeafPhotoChipItems(
      [
        {
          category: 'home_food',
          displayName: 'Home Food',
          icon: 'Utensils',
          imageUrl: 'https://example.com/food.jpg',
        },
        {
          category: 'beauty',
          displayName: 'Beauty',
          icon: 'Sparkles',
          imageUrl: null,
        },
        {
          category: 'tuition',
          displayName: 'Tuition',
          icon: 'Book',
        },
      ],
      ['home_food', 'beauty'],
    );
    expect(items.map((i) => i.label)).toEqual(['Home Food', 'Beauty']);
    expect(items.map((i) => i.id)).toEqual(['home_food', 'beauty']);
    expect(items.every((i) => !/Food & Beverages|Personal Care|Education & Learning/i.test(i.label))).toBe(true);
    expect(items[0].imageUrl).toBe('https://example.com/food.jpg');
  });

  it('Home sticky rail uses leaf categories via shared chip rail (not parent-group All / Food & Beverages)', () => {
    const tabs = read('components/home/ParentGroupTabs.tsx');
    expect(tabs).toMatch(/CategoryPhotoChipRail/);
    expect(tabs).toMatch(/buildLeafPhotoChipItems/);
    expect(tabs).toMatch(/from '@\/components\/category\/CategoryPhotoChipRail'/);
    expect(tabs).toMatch(/useCategoryConfigs/);
    expect(tabs).toMatch(/activeCategory/);
    expect(tabs).toMatch(/allowDeselect/);
    expect(tabs).not.toMatch(/useParentGroups/);
    expect(tabs).not.toMatch(/__all__/);
    expect(tabs).not.toMatch(/festivalTabs/);
    expect(tabs).toMatch(/useFestivalTakeover/);
    // Old horizontal pill layout must not return
    expect(tabs).not.toMatch(/rounded-full transition-all duration-300 relative overflow-hidden/);
    expect(tabs).not.toMatch(/layoutId="activeGroupPill"/);
    // No private chip button markup - chrome lives only in CategoryPhotoChipRail
    expect(tabs).not.toContain(CATEGORY_PHOTO_CHIP_TOKENS.button);
    expect(tabs).not.toContain('min-w-[68px]');
    expect(tabs).not.toContain('w-9 h-9 rounded-full');
  });

  it('Search category row uses the same shared leaf chip rail (not CategoryBubbleRow, not parent groups)', () => {
    const search = read('pages/SearchPage.tsx');
    expect(search).toMatch(/CategoryPhotoChipRail/);
    expect(search).toMatch(/buildLeafPhotoChipItems/);
    expect(search).toMatch(/from '@\/components\/category\/CategoryPhotoChipRail'/);
    expect(search).not.toMatch(/function CategoryBubbleRow/);
    expect(search).not.toMatch(/CategoryBubbleRow/);
    expect(search).not.toMatch(/useParentGroups/);
    expect(search).not.toMatch(/Food & Beverages/);
    // No private chip button markup - must match Home via shared tokens
    expect(search).not.toContain(CATEGORY_PHOTO_CHIP_TOKENS.button);
    expect(search).not.toContain('min-w-[68px]');
    expect(search).not.toContain('w-9 h-9 rounded-full');
    expect(search).not.toContain('bg-muted/60 hover:bg-muted');
  });

  it('Home and Search share identical chip chrome tokens via CategoryPhotoChipRail', () => {
    const rail = read('components/category/CategoryPhotoChipRail.tsx');
    const tabs = read('components/home/ParentGroupTabs.tsx');
    const search = read('pages/SearchPage.tsx');
    const home = read('components/home/MarketplaceSection.tsx');

    const sharedTokens = [
      CATEGORY_PHOTO_CHIP_TOKENS.button,
      CATEGORY_PHOTO_CHIP_TOKENS.photo,
      CATEGORY_PHOTO_CHIP_TOKENS.label,
      CATEGORY_PHOTO_CHIP_TOKENS.buttonActive,
      CATEGORY_PHOTO_CHIP_TOKENS.buttonInactive,
      'w-9 h-9',
      'rounded-2xl',
      'text-[10px]',
      'line-clamp-2',
      'min-w-[68px]',
      'bg-primary',
      'bg-muted/60',
    ];

    for (const token of sharedTokens) {
      expect(rail).toContain(token);
    }

    // Both screens only reference the shared component; neither redefines chip chrome
    expect(tabs).toMatch(/<CategoryPhotoChipRail/);
    expect(search).toMatch(/<CategoryPhotoChipRail/);
    // Home wires leaf selection through ParentGroupTabs
    expect(home).toMatch(/activeCategory=/);
    expect(home).toMatch(/onCategoryChange=/);
    expect(home).toMatch(/activeCategories=/);
  });
});
