// @ts-nocheck
import { Plus, ShoppingBag, Calendar, Send, MessageCircle, Phone, Home, Handshake } from 'lucide-react';

/** Single source of truth for marketplace discovery radius (km). */
export const MARKETPLACE_RADIUS_KM = 5;
import { ProductActionType } from '@/types/Database';

/**
 * Shared ACTION_CONFIG — single source of truth for all product action buttons.
 * Used by ProductGridCard, ProductDetailSheet, ProductCard, ListingCard, etc.
 */
export const ACTION_CONFIG: Record<ProductActionType, { label: string; shortLabel: string; icon: typeof Plus; isCart: boolean }> = {
  add_to_cart: { label: 'Add to Cart', shortLabel: 'ADD', icon: Plus, isCart: true },
  buy_now: { label: 'Buy Now', shortLabel: 'BUY', icon: ShoppingBag, isCart: true },
  book: { label: 'Book Now', shortLabel: 'Book', icon: Calendar, isCart: false },
  request_service: { label: 'Request Service', shortLabel: 'Request', icon: Send, isCart: false },
  request_quote: { label: 'Request Quote', shortLabel: 'Quote', icon: MessageCircle, isCart: false },
  contact_seller: { label: 'Contact Seller', shortLabel: 'Contact', icon: Phone, isCart: false },
  schedule_visit: { label: 'Schedule Visit', shortLabel: 'Visit', icon: Home, isCart: false },
  make_offer: { label: 'Make an Offer', shortLabel: 'Offer', icon: Handshake, isCart: false },
};

/** Shared sort options used across CategoryPage, CategoryGroupPage, and SearchPage */
export const SORT_OPTIONS = [
  { key: 'relevance' as const, label: 'Relevance' },
  { key: 'nearest' as const, label: 'Nearest' },
  { key: 'price_low' as const, label: 'Price: Low' },
  { key: 'price_high' as const, label: 'Price: High' },
  { key: 'popular' as const, label: 'Popular' },
  { key: 'rating' as const, label: 'Rating' },
  { key: 'newest' as const, label: 'Newest' },
] as const;

export type SortKey = (typeof SORT_OPTIONS)[number]['key'];

/**
 * TX_TO_ACTION — maps category transaction_type → product action_type.
 * Used ONLY as a frontend fallback when product.action_type is not set.
 * Canonical source of truth is the DB table `action_type_workflow_map`.
 */
export const TX_TO_ACTION: Record<string, ProductActionType> = {
  cart_purchase: 'add_to_cart',
  seller_delivery: 'add_to_cart',
  self_fulfillment: 'add_to_cart',
  buy_now: 'buy_now',
  book_slot: 'book',
  service_booking: 'book',
  request_service: 'request_service',
  request_quote: 'request_quote',
  contact_seller: 'contact_seller',
  contact_enquiry: 'contact_seller',
  contact_only: 'contact_seller',
  schedule_visit: 'schedule_visit',
  make_offer: 'make_offer',
};

/** Resolve effective action type: product override > category config flags > fallback */
export function deriveActionType(
  productActionType: string | null | undefined,
  categoryTransactionType: string | null | undefined,
  categoryFlags?: { supportsCart?: boolean; enquiryOnly?: boolean } | null,
): ProductActionType {
  const productAction =
    productActionType && productActionType in ACTION_CONFIG
      ? (productActionType as ProductActionType)
      : null;

  // Stale product.action_type=add_to_cart must not override a category that forbids cart.
  // (DB trigger validate_cart_item_category rejects these inserts.)
  if (
    productAction &&
    (productAction === 'add_to_cart' || productAction === 'buy_now') &&
    categoryFlags?.supportsCart === false
  ) {
    if (categoryFlags.enquiryOnly) return 'contact_seller';
    if (categoryTransactionType && TX_TO_ACTION[categoryTransactionType]) {
      const mapped = TX_TO_ACTION[categoryTransactionType];
      if (mapped !== 'add_to_cart' && mapped !== 'buy_now') return mapped;
    }
    return 'request_quote';
  }

  if (productAction) return productAction;
  if (categoryTransactionType && TX_TO_ACTION[categoryTransactionType]) return TX_TO_ACTION[categoryTransactionType];
  // Fallback: use category behavior flags when transaction_type is unmapped (e.g. 'self_fulfillment')
  if (categoryFlags) {
    if (categoryFlags.supportsCart) return 'add_to_cart';
    if (categoryFlags.enquiryOnly) return 'contact_seller';
    return 'book';
  }
  return 'add_to_cart';
}

/**
 * Derive the correct action type from category config flags.
 * Used when transaction_type alone is insufficient (e.g. 'self_fulfillment').
 */
export function deriveActionFromCategoryFlags(
  cfg: { supportsCart?: boolean; enquiryOnly?: boolean; transactionType?: string } | null | undefined,
): ProductActionType {
  if (!cfg) return 'add_to_cart';
  // First try the direct transaction_type mapping
  if (cfg.transactionType && TX_TO_ACTION[cfg.transactionType]) {
    return TX_TO_ACTION[cfg.transactionType];
  }
  // Fall back to category behavior flags
  if (cfg.supportsCart) return 'add_to_cart';
  if (cfg.enquiryOnly) return 'contact_seller';
  return 'book';
}
