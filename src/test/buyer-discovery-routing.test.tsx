import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { ACTION_CONFIG, deriveActionType } from '@/lib/marketplace-constants';

const homePage = readFileSync(resolve(__dirname, '../pages/HomePage.tsx'), 'utf8');

describe('buyer discovery routing contracts', () => {
  it('does not show Home popular-search chips or route them into /search', () => {
    expect(homePage).not.toMatch(/HomeSearchSuggestions/);
    expect(homePage).not.toMatch(/label_section_search_popular/);
    expect(homePage).not.toMatch(/\/search\?q=/);
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
