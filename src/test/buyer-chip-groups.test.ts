import { describe, expect, it } from 'vitest';
import {
  categoriesForBuyerChip,
  categoryMatchesBuyerChip,
} from '@/lib/buyer-chip-groups';

describe('buyer chip groups', () => {
  it('shows coaching with tuition and beauty with salon', () => {
    expect(categoriesForBuyerChip('tuition').sort()).toEqual(['coaching', 'tuition']);
    expect(categoriesForBuyerChip('salon').sort()).toEqual(['beauty', 'salon']);
    expect(categoriesForBuyerChip('medical_specialist')).toEqual(['medical_specialist']);
  });

  it('keeps a tapped chip matched to every listing in the group', () => {
    expect(categoryMatchesBuyerChip('coaching', 'tuition')).toBe(true);
    expect(categoryMatchesBuyerChip('tuition', 'tuition')).toBe(true);
    expect(categoryMatchesBuyerChip('beauty', 'salon')).toBe(true);
    expect(categoryMatchesBuyerChip('salon', 'salon')).toBe(true);
    expect(categoryMatchesBuyerChip('coaching', 'salon')).toBe(false);
    expect(categoryMatchesBuyerChip('medical_specialist', 'medical_specialist')).toBe(true);
  });
});
