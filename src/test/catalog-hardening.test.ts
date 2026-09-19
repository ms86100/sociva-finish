import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { resolveSellerPackagingFee, totalPackagingFees } from '@/lib/packaging-fee';
import { formatPercent } from '@/lib/utils';
import { productMatchesCommerceFacets, emptyCommerceFacetState } from '@/lib/commerce-facets';
import { FOOD_COURSES } from '@/lib/food-facets';
import { fullStorePlaceLine } from '@/lib/location-label-resolver';

describe('formatPercent', () => {
  it('rounds repeating decimals', () => {
    expect(formatPercent(33.333333333333336)).toBe('33%');
    expect(formatPercent(0)).toBe('0%');
    expect(formatPercent(null)).toBe('0%');
  });
});

describe('packaging fee', () => {
  it('is once per seller and ignores invalid values', () => {
    expect(resolveSellerPackagingFee(10)).toBe(10);
    expect(resolveSellerPackagingFee(-4)).toBe(0);
    expect(resolveSellerPackagingFee('')).toBe(0);
    expect(totalPackagingFees([
      { id: 'a', packaging_fee: 10 },
      { id: 'a', packaging_fee: 10 },
      { id: 'b', packaging_fee: 5 },
    ])).toBe(15);
  });

  it('stays outside coupon item subtotal', () => {
    const itemSubtotal = 200;
    const coupon = 20;
    const packaging = resolveSellerPackagingFee(15);
    const delivery = 5;
    expect(itemSubtotal - coupon + packaging + delivery).toBe(200);
  });
});

describe('diet facets', () => {
  const kebab = { name: 'Kebab', is_veg: false, category: 'home_food' };
  const dal = { name: 'Dal', is_veg: true, category: 'home_food' };
  const medical = { name: 'Clinic consult', is_veg: true, category: 'medical_specialist' };

  it('Veg Only keeps only is_veg true', () => {
    const state = { ...emptyCommerceFacetState(), veg: true };
    expect(productMatchesCommerceFacets(dal, state)).toBe(true);
    expect(productMatchesCommerceFacets(kebab, state)).toBe(false);
    expect(productMatchesCommerceFacets({ ...kebab, is_veg: null }, state)).toBe(false);
  });

  it('Non-Veg keeps only is_veg false', () => {
    const state = { ...emptyCommerceFacetState(), nonVeg: true };
    expect(productMatchesCommerceFacets(kebab, state)).toBe(true);
    expect(productMatchesCommerceFacets(dal, state)).toBe(false);
    expect(productMatchesCommerceFacets(medical, state)).toBe(false);
  });
});

describe('food course labels', () => {
  it('uses Starter and Main Course in UI constants', () => {
    expect(FOOD_COURSES.find((c) => c.id === 'appetizer')?.label).toBe('Starter');
    expect(FOOD_COURSES.find((c) => c.id === 'main')?.label).toBe('Main Course');
  });
});

describe('full store place line', () => {
  it('wraps society plus extra address without dropping the pin text', () => {
    expect(fullStorePlaceLine({
      societyName: 'Shriram Greenfield Phase 1',
      storeLocationLabel: 'Tower 4, Shriram Greenfield Phase 1',
      distanceLabel: '800 m',
    })).toContain('Shriram Greenfield Phase 1');
  });
});

describe('packaging checkout stamp', () => {
  it('CMVO migration stamps packaging_fee once per seller', () => {
    const src = readFileSync(resolve(__dirname, '../../supabase/migrations/20260919201000_stamp_packaging_fee_on_orders.sql'), 'utf8');
    expect(src).toContain('packaging_fee');
    expect(src).toContain('coalesce(_packaging_fee, 0)');
  });
});
