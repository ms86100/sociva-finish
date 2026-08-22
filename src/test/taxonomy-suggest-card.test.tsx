import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaxonomySuggestCard } from '@/components/seller/TaxonomySuggestCard';
import type { ResolvedListingIntent } from '@/lib/listing-intent';

const baseResolved: ResolvedListingIntent = {
  commerceModel: 'cart',
  listingKindHint: 'product',
  suggestedCategorySlug: 'one_time_meals',
  suggestedCategoryConfigId: 'cfg-meals',
  suggestedSubcategoryId: null,
  suggestedSubcategoryName: null,
  suggestedParentGroup: 'food_beverages',
  confidence: 3,
  matchedAlias: 'biryani',
  seedProductName: 'Biryani',
  needsOtherSubcategory: true,
  useCustomSubcategoryLabel: 'Biryani',
  matchBand: 'strong',
};

describe('TaxonomySuggestCard', () => {
  it('shows a strong match with Continue, not a request-first dead end', () => {
    render(
      <TaxonomySuggestCard
        intentPhrase="Biryani"
        resolved={baseResolved}
        categoryDisplayName="One-time Meals"
        onConfirm={vi.fn()}
        onChangeTaxonomy={vi.fn()}
        onRequestCategory={vi.fn()}
        onContinueClosest={vi.fn()}
      />,
    );
    expect(screen.getByText(/We found a category for Biryani/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continue/i })).toBeTruthy();
    expect(screen.getByText(/Request a new category/i)).toBeTruthy();
    expect(screen.queryByText(/We couldn't place that yet/i)).toBeNull();
  });

  it('treats a weak parent fallback as closest match, with request last', () => {
    render(
      <TaxonomySuggestCard
        intentPhrase="Korean fermented soybean paste"
        resolved={{
          ...baseResolved,
          suggestedCategorySlug: 'other-food',
          suggestedCategoryConfigId: 'cfg-other',
          suggestedParentGroup: 'food_beverages',
          confidence: 0.9,
          matchedAlias: 'closest parent',
          seedProductName: 'Korean fermented soybean paste',
          matchBand: 'weak',
          needsOtherSubcategory: false,
          useCustomSubcategoryLabel: null,
        }}
        categoryDisplayName="Other Food"
        onConfirm={vi.fn()}
        onChangeTaxonomy={vi.fn()}
        onRequestCategory={vi.fn()}
        onContinueClosest={vi.fn()}
      />,
    );
    expect(screen.getByText(/couldn't find an exact match/i)).toBeTruthy();
    expect(screen.getAllByText(/closest existing category/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Continue with this/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Choose another/i })).toBeTruthy();
  });
});
