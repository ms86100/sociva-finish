import { describe, expect, it } from 'vitest';
import {
  extrasHaveRequiredGaps,
  extractBuyerOptionGroups,
  formatSelectedExtras,
  sanitizeSelectedExtras,
} from '@/lib/productExtras';

const library = [
  {
    block_type: 'buyer_class_slot',
    display_name: 'Class preferences',
    buyer_selectable: true,
    schema: {
      fields: [
        { key: 'level', label: 'Level', type: 'select', options: ['Beginner', 'Advanced'] },
        { key: 'goal', label: 'Goal', type: 'textarea' },
      ],
    },
  },
  {
    block_type: 'food_facts',
    display_name: 'Food facts',
    buyer_selectable: false,
    schema: { fields: [{ key: 'cuisine', label: 'Cuisine', type: 'select', options: ['North Indian', 'Chinese'] }] },
  },
];

describe('product extras', () => {
  it('exposes variants and buyer-selectable fields, not seller-only facts', () => {
    const groups = extractBuyerOptionGroups({
      blocks: [
        { type: 'variants', data: { options: [{ label: 'Size', values: ['S', 'M'] }] } },
        { type: 'buyer_class_slot', data: { level: 'Beginner', goal: '' } },
        { type: 'food_facts', data: { cuisine: 'North Indian' } },
      ],
    }, library);

    expect(groups.map((g) => g.fieldLabel)).toEqual(['Size', 'Level', 'Goal']);
    expect(groups.find((g) => g.fieldKey === 'level')?.options).toEqual(['Beginner', 'Advanced']);
    expect(groups.find((g) => g.fieldKey === 'cuisine')).toBeUndefined();
  });

  it('sanitizes illegal choices and formats extras', () => {
    const groups = extractBuyerOptionGroups({
      blocks: [{ type: 'variants', data: { options: [{ label: 'Size', values: ['S', 'M'] }] } }],
    }, library);
    const selected = sanitizeSelectedExtras([
      { id: groups[0].id, blockType: 'variants', blockLabel: 'variants', fieldKey: 'Size', fieldLabel: 'Size', value: 'XL' },
    ], groups);
    expect(selected).toEqual([]);

    const valid = sanitizeSelectedExtras([
      { id: groups[0].id, blockType: 'variants', blockLabel: 'variants', fieldKey: 'Size', fieldLabel: 'Size', value: 'M' },
    ], groups);
    expect(formatSelectedExtras(valid)).toBe('Size: M');
    expect(extrasHaveRequiredGaps(groups, valid)).toBe(false);
    expect(extrasHaveRequiredGaps(groups, [])).toBe(true);
  });
});
