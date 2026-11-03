import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductGridSkeleton } from '@/components/placeholders/ProductGridSkeleton';
import { ProductDetailSkeleton } from '@/components/placeholders/ProductDetailSkeleton';
import { CartSkeleton, CheckoutSkeleton } from '@/components/placeholders/CartCheckoutSkeleton';
import { SearchResultsSkeleton } from '@/components/placeholders/SearchResultsSkeleton';
import { phaseFromQuery } from '@/components/placeholders/ContentLoadState';
import { ProductCardSkeleton } from '@/components/product/ProductCardSkeleton';

describe('content-aware placeholders', () => {
  it('renders product grid skeleton geometry without fake product copy', () => {
    const { container } = render(<ProductGridSkeleton count={4} variant="food" />);
    expect(screen.getByTestId('product-grid-skeleton')).toHaveAttribute('data-variant', 'food');
    expect(screen.getByLabelText('Loading products')).toBeInTheDocument();
    expect(container.textContent?.replace(/\s/g, '')).toBe('');
  });

  it('ProductCardSkeleton stays a compatible alias', () => {
    render(<ProductCardSkeleton count={2} variant="service" />);
    expect(screen.getByTestId('product-grid-skeleton')).toHaveAttribute('data-variant', 'service');
  });

  it('renders detail / cart / checkout / search shells', () => {
    const { rerender } = render(<ProductDetailSkeleton />);
    expect(screen.getByTestId('product-detail-skeleton')).toBeInTheDocument();
    rerender(<CartSkeleton lines={2} />);
    expect(screen.getByTestId('cart-skeleton')).toBeInTheDocument();
    rerender(<CheckoutSkeleton />);
    expect(screen.getByTestId('checkout-skeleton')).toBeInTheDocument();
    rerender(<SearchResultsSkeleton count={2} />);
    expect(screen.getByTestId('search-results-skeleton')).toBeInTheDocument();
  });

  it('phaseFromQuery separates loading, empty, error, offline, refresh', () => {
    expect(phaseFromQuery({ isLoading: true, isEmpty: false })).toBe('loading');
    expect(phaseFromQuery({ isLoading: false, isEmpty: true })).toBe('empty');
    expect(phaseFromQuery({ isLoading: false, isEmpty: false, isError: true })).toBe('error');
    expect(phaseFromQuery({ isLoading: false, isEmpty: false, isOffline: true })).toBe('offline');
    expect(phaseFromQuery({ isLoading: false, isEmpty: false, isFetching: true })).toBe('refreshing');
    expect(phaseFromQuery({ isLoading: false, isEmpty: false })).toBe('ready');
  });
});
