import { describe, expect, it } from 'vitest';
import { sellersInOwnSociety } from '@/lib/store-discovery-society';

describe('in-society store row', () => {
  it('keeps sell-beyond kitchens out of another society label', () => {
    const rows = [
      { id: '1', society_name: 'Lakeview Proof Residency' },
      { id: '2', society_name: 'Shriram Greenfield Phase-2, Tower H' },
      { id: '3', society_name: null },
    ];
    expect(sellersInOwnSociety(rows, 'Lakeview Proof Residency').map((s) => s.id)).toEqual(['1']);
  });
});
