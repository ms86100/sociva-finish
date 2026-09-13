/**
 * Buyer-reach copy for seller onboarding (domain → reach → category).
 */

import type { BuyerJourneyId } from '@/lib/buyer-journey';
import type { SellerDomain } from '@/lib/seller-domain';
import { commerceModelFromCategory, type CategoryDomainInput } from '@/lib/seller-domain';
import { commerceModelFromActionType, type CommerceModel } from '@/lib/listing-intent';

export type BuyerReachId = Extract<BuyerJourneyId, 'cart' | 'book' | 'contact'>;

export const BUYER_REACH_COPY: Record<
  BuyerReachId,
  { badge: string; title: string; help: string; summary: string }
> = {
  cart: {
    badge: 'Add to cart',
    title: 'Buyers add to cart',
    help: 'Buyers checkout and pay in the app',
    summary: 'Buyers will Add to cart and check out',
  },
  book: {
    badge: 'Book a slot',
    title: 'Buyers book a slot',
    help: 'Buyers pick a date or time with you',
    summary: 'Buyers will Book a slot with you',
  },
  contact: {
    badge: 'Contact you',
    title: 'Buyers contact you',
    help: 'Buyers message or call to enquire — no cart checkout',
    summary: 'Buyers will Contact you to enquire',
  },
};

export const DOMAIN_REACH_HELP: Record<SellerDomain, string> = {
  product: 'Things buyers buy and check out in the app',
  service: 'Things buyers book a slot for, or contact you about',
  listing: 'People, property, or professional offers — buyers usually contact you',
};

/** Which reach options are offered after a domain is chosen. */
export function reachesForDomain(domain: SellerDomain): BuyerReachId[] {
  if (domain === 'product') return ['cart'];
  if (domain === 'listing') return ['contact'];
  return ['book', 'contact'];
}

export function defaultReachForDomain(domain: SellerDomain): BuyerReachId {
  return reachesForDomain(domain)[0];
}

export function reachToCommerceModel(reach: BuyerReachId): CommerceModel {
  return reach;
}

export function actionTypeToReach(actionType: string | null | undefined): BuyerReachId | null {
  const model = commerceModelFromActionType(actionType);
  if (model === 'cart' || model === 'book' || model === 'contact') return model;
  if (model === 'enquire') return 'contact';
  return null;
}

/** Map category config → primary buyer reach (default for that category). */
export function categoryDefaultReach(input: CategoryDomainInput): BuyerReachId {
  const model = commerceModelFromCategory(input);
  if (model === 'cart') return 'cart';
  if (model === 'book') return 'book';
  return 'contact';
}

/**
 * Does this category support the chosen reach?
 * Uses allowed action types when provided; otherwise matches category default.
 */
export function categoryMatchesReach(
  input: CategoryDomainInput,
  reach: BuyerReachId,
  allowedActionTypes: string[] | null | undefined,
): boolean {
  if (allowedActionTypes && allowedActionTypes.length > 0) {
    if (reach === 'cart') {
      return allowedActionTypes.some((a) => a === 'add_to_cart' || a === 'buy_now');
    }
    if (reach === 'book') {
      return allowedActionTypes.some((a) => a === 'book' || a === 'schedule_visit');
    }
    // contact
    return allowedActionTypes.some(
      (a) => a === 'contact_seller' || a === 'request_quote' || a === 'request_service' || a === 'make_offer',
    );
  }
  return categoryDefaultReach(input) === reach;
}
