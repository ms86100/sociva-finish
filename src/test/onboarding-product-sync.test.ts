import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isPriceRequirementError,
  isStaleDraftProductName,
  normalizeSeedOfferingNames,
  pendingOfferingNamesForProducts,
  shouldSkipPricelessDraftInsert,
} from '@/lib/onboarding-product-sync';

describe('offering product seed helpers', () => {
  it('dedupes offering names and ignores blanks', () => {
    expect(normalizeSeedOfferingNames(
      ['Rajma Chawal', '  Dal Makhani  ', ''],
      'Rajma Chawal',
      'Cakes',
    )).toEqual(['Rajma Chawal', 'Dal Makhani', 'Cakes']);
  });

  it('treats leftover Facial as stale when current offerings are food', () => {
    expect(isStaleDraftProductName('Facial', ['Rajma Chawal', 'Dal Makhani', 'Cakes'])).toBe(true);
    expect(isStaleDraftProductName('Rajma Chawal', ['Rajma Chawal', 'Dal Makhani'])).toBe(false);
    expect(isStaleDraftProductName('Facial', [])).toBe(false);
  });

  it('skips priceless inserts unless the category is known to allow them', () => {
    expect(shouldSkipPricelessDraftInsert(true)).toBe(true);
    expect(shouldSkipPricelessDraftInsert(null)).toBe(true);
    expect(shouldSkipPricelessDraftInsert(undefined)).toBe(true);
    expect(shouldSkipPricelessDraftInsert(false)).toBe(false);
  });

  it('lists remaining offerings after a saved product and keeps review locked', () => {
    expect(pendingOfferingNamesForProducts(
      ['Rajma Chawal', 'Dal Makhani', 'Cakes'],
      ['Dal Makhani'],
    )).toEqual(['Rajma Chawal', 'Cakes']);
    expect(pendingOfferingNamesForProducts(
      ['Rajma Chawal', 'Dal Makhani', 'Cakes'],
      ['Rajma Chawal', 'Dal Makhani', 'Cakes'],
    )).toEqual([]);
  });
});

describe('onboarding product seed contracts', () => {
  it('products step prefers typed offerings over leftover seed names', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/BecomeSellerPage.tsx'), 'utf8');
    expect(src).toContain('normalizeOfferingNames(offeringNames || [])[0] || seedProductName');
    expect(src).toContain('if (names[0]) setSeedProductName(names[0])');
  });

  it('draft form discards stale leftover names and lists pending offerings', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/seller/DraftProductManager.tsx'), 'utf8');
    expect(src).toContain('isStaleDraftProductName');
    expect(src).toContain('Offerings to add');
    expect(src).toContain('fillOffering');
    expect(src).toContain('startFreshForm');
    expect(src).toContain('alreadySaved && looksEmpty');
  });

  it('review stays locked until every named offering is saved', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/BecomeSellerPage.tsx'), 'utf8');
    expect(src).toContain('pendingOfferingNamesForProducts');
    expect(src).toContain('pendingOfferings.length > 0');
    expect(src).toContain('Add remaining offerings before review');
  });
});
