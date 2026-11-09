import { describe, expect, it } from 'vitest';
import {
  BUYER_REACH_COPY,
  categoryMatchesReach,
  defaultReachForDomain,
  reachesForDomain,
} from '@/lib/buyer-reach';

describe('buyer reach onboarding helpers', () => {
  it('offers cart only for product domain', () => {
    expect(reachesForDomain('product')).toEqual(['cart']);
    expect(defaultReachForDomain('product')).toBe('cart');
  });

  it('offers book and contact for service domain', () => {
    expect(reachesForDomain('service')).toEqual(['book', 'contact']);
  });

  it('offers contact for listing domain', () => {
    expect(reachesForDomain('listing')).toEqual(['contact']);
  });

  it('matches salon contact via allowed actions', () => {
    const salon = {
      parentGroup: 'personal_care',
      category: 'salon',
      transactionType: 'service_booking',
      defaultActionType: 'book',
      requiresTimeSlot: true,
    };
    expect(categoryMatchesReach(salon, 'book', ['book', 'contact_seller'])).toBe(true);
    expect(categoryMatchesReach(salon, 'contact', ['book', 'contact_seller'])).toBe(true);
    expect(categoryMatchesReach(salon, 'cart', ['book', 'contact_seller'])).toBe(false);
  });

  it('exposes self-explanatory copy for each reach', () => {
    expect(BUYER_REACH_COPY.cart.badge).toMatch(/cart/i);
    expect(BUYER_REACH_COPY.book.badge).toMatch(/book/i);
    expect(BUYER_REACH_COPY.contact.badge).toMatch(/contact/i);
  });
});
