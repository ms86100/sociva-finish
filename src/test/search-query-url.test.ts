import { describe, expect, it } from 'vitest';
import { readSearchQueryParam, resolveSearchQueryFromUrl } from '@/lib/searchQuery';

describe('search query URL hydration', () => {
  it('preserves a trailing space between words so the next word is not concatenated', () => {
    expect(resolveSearchQueryFromUrl('jhol ', 'jhol')).toBe('jhol ');
    expect(resolveSearchQueryFromUrl('jhol momo', 'jhol momo')).toBe('jhol momo');
  });

  it('does not strip encoded spaces from the URL param', () => {
    const params = new URLSearchParams('q=jhol+momo');
    expect(readSearchQueryParam(params)).toBe('jhol momo');
    expect(readSearchQueryParam(params).includes(' ')).toBe(true);
  });

  it('applies a different query from back/forward or a suggestion tap', () => {
    expect(resolveSearchQueryFromUrl('jhol momo', 'paneer tikka')).toBe('paneer tikka');
    expect(resolveSearchQueryFromUrl('guitar', '')).toBe('');
  });

  it('keeps extra keystrokes when the URL has not caught up yet', () => {
    expect(resolveSearchQueryFromUrl('jhol m', 'jhol ')).toBe('jhol m');
    expect(resolveSearchQueryFromUrl('jhol momo', 'jhol')).toBe('jhol momo');
  });
});
