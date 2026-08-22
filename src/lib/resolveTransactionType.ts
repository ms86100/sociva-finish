// @ts-nocheck
/**
 * Shared utility: resolves the transaction_type (workflow key) for order execution.
 *
 * Canonical: stamped `orders.transaction_type` at creation (fulfillment-aware).
 * Heals known add_to_cart mis-stamps that always wrote `cart_purchase`.
 * Legacy branches below exist only for pre-migration / unstamped rows.
 */

/** Mirror of public.resolve_cart_order_transaction_type */
export function resolveCartOrderTransactionType(
  fulfillmentType?: string | null,
  deliveryHandledBy?: string | null,
): string {
  if (fulfillmentType === 'self_pickup') return 'self_fulfillment';
  if (fulfillmentType === 'seller_delivery') return 'seller_delivery';
  if (fulfillmentType === 'delivery' && (deliveryHandledBy === 'seller' || !deliveryHandledBy)) {
    return 'seller_delivery';
  }
  if (fulfillmentType === 'delivery' && deliveryHandledBy === 'platform') return 'cart_purchase';
  return 'cart_purchase';
}

/** Heal cart_purchase stamped on seller-delivery / self-pickup orders. */
export function healOrderTransactionType(
  stored: string | null | undefined,
  fulfillmentType?: string | null,
  deliveryHandledBy?: string | null,
): string | null {
  if (!stored) return null;
  if (stored === 'cart_purchase') {
    if (fulfillmentType === 'self_pickup') return 'self_fulfillment';
    if (
      (fulfillmentType === 'delivery' || fulfillmentType === 'seller_delivery') &&
      (deliveryHandledBy === 'seller' || !deliveryHandledBy)
    ) {
      return 'seller_delivery';
    }
  }
  return stored;
}

/** Enquiry orders never use the booking workflow, including classes/events. */
export function resolveEnquiryTransactionType(listingType?: string | null): string {
  if (listingType === 'contact_only' || listingType === 'contact_enquiry') return 'contact_enquiry';
  return 'request_service';
}

export function resolveTransactionType(
  parentGroup: string,
  orderType: string | null | undefined,
  fulfillmentType?: string | null,
  deliveryHandledBy?: string | null,
  listingType?: string | null,
  /** Stored transaction_type from the order row (new orders have this set at creation) */
  storedTransactionType?: string | null
): string {
  // Prefer healed stamp so UI matches seller_advance_order / DB backfill
  if (storedTransactionType) {
    const healed =
      healOrderTransactionType(storedTransactionType, fulfillmentType, deliveryHandledBy) ||
      storedTransactionType;
    if (
      orderType === 'enquiry' &&
      (healed === 'service_booking' || healed === 'book_slot')
    ) {
      return resolveEnquiryTransactionType(listingType);
    }
    return healed;
  }

  // Legacy fallback for orders created before the migration
  if (listingType === 'contact_enquiry' || listingType === 'contact_only') return 'contact_enquiry';

  if (orderType === 'enquiry') {
    return resolveEnquiryTransactionType(listingType);
  }
  if (orderType === 'booking') return 'service_booking';

  if (fulfillmentType) {
    return resolveCartOrderTransactionType(fulfillmentType, deliveryHandledBy);
  }

  if (listingType) {
    if (listingType === 'contact_only') return 'contact_enquiry';
    return listingType;
  }

  return 'self_fulfillment';
}
