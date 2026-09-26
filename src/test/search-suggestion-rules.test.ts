import { describe, it, expect } from 'vitest';
import {
  categoryIsSuggestable,
  liveCategorySlugs,
  suggestionShowsPrice,
} from '@/lib/searchSuggestionRules';

describe('search suggestion rules', () => {
  it('shows a contact price only when the amount is above 1 rupee', () => {
    expect(suggestionShowsPrice('contact_seller', 799)).toBe(true);
    expect(suggestionShowsPrice('contact_seller', 0)).toBe(false);
    expect(suggestionShowsPrice('contact_seller', 1)).toBe(false);
    expect(suggestionShowsPrice('contact_seller', null)).toBe(false);
    expect(suggestionShowsPrice('request_quote', 0)).toBe(false);
    expect(suggestionShowsPrice('schedule_visit', null)).toBe(false);
    expect(suggestionShowsPrice('make_offer', 1)).toBe(false);
    expect(suggestionShowsPrice('add_to_cart', 180)).toBe(true);
    expect(suggestionShowsPrice('book', 500)).toBe(true);
    expect(suggestionShowsPrice(null, 0)).toBe(false);
  });

  it('suggests a category slug only when the live product set contains it', () => {
    const live = liveCategorySlugs([
      {
        matching_products: [
          { category: 'medicines', is_available: true },
          { category: 'carpenter', is_available: false },
        ],
      },
    ]);

    expect(categoryIsSuggestable('medicines', true, live, true)).toBe(true);
    expect(categoryIsSuggestable('carpenter', true, live, true)).toBe(false);
    expect(categoryIsSuggestable('plumber', true, live, true)).toBe(false);
    expect(categoryIsSuggestable('medicines', false, live, true)).toBe(false);
    expect(categoryIsSuggestable('medicines', true, live, false)).toBe(false);
  });
});
