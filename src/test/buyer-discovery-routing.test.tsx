import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HomeSearchSuggestions } from '@/components/home/HomeSearchSuggestions';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';

vi.mock('@/hooks/queries/useCommunitySearchSuggestions', () => ({
  useCommunitySearchSuggestions: () => ({
    data: [{ term: 'Fresh paneer & bread', count: 12 }],
  }),
}));

vi.mock('@/hooks/useMarketplaceLabels', () => ({
  useMarketplaceLabels: () => ({ label: () => 'Popular searches' }),
}));

function CurrentLocation() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

describe('buyer discovery routing contracts', () => {
  it('routes a discovery suggestion to an encoded search URL', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <HomeSearchSuggestions />
        <CurrentLocation />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Fresh paneer & bread/i }));

    expect(screen.getByTestId('location')).toHaveTextContent(
      '/search?q=Fresh%20paneer%20%26%20bread',
    );
  });

  it.each([
    ['cart_purchase', 'add_to_cart', true],
    ['service_booking', 'book', false],
    ['request_service', 'request_service', false],
    ['contact_enquiry', 'contact_seller', false],
  ] as const)(
    'maps %s listings to the %s buyer action',
    (transactionType, expectedAction, isCart) => {
      const action = deriveActionType(null, transactionType);

      expect(action).toBe(expectedAction);
      expect(ACTION_CONFIG[action].isCart).toBe(isCart);
    },
  );

  it('keeps a valid product action override ahead of category routing', () => {
    expect(deriveActionType('make_offer', 'cart_purchase')).toBe('make_offer');
  });
});
