// @ts-nocheck
/**
 * Shared utility: resolves the transaction_type (workflow key) for order execution.
 *
 * Canonical: stamped `orders.transaction_type` at creation.
 * Legacy branches below exist only for pre-migration rows.
 */
export function resolveTransactionType(
  parentGroup: string,
  orderType: string | null | undefined,
  fulfillmentType?: string | null,
  deliveryHandledBy?: string | null,
  listingType?: string | null,
  /** Stored transaction_type from the order row (new orders have this set at creation) */
  storedTransactionType?: string | null
): string {
  // Prefer the stored transaction_type from the order (set at creation, single source of truth)
  if (storedTransactionType) return storedTransactionType;

  // Legacy fallback for orders created before the migration
  if (listingType === 'contact_enquiry' || listingType === 'contact_only') return 'contact_enquiry';

  if (orderType === 'enquiry') {
    if (['classes', 'events'].includes(parentGroup)) return 'service_booking';
    return 'request_service';
  }
  if (orderType === 'booking') return 'service_booking';

  // Fulfillment sub-variants (runtime only for legacy unstamped cart orders)
  if (fulfillmentType === 'self_pickup') return 'self_fulfillment';
  if (fulfillmentType === 'seller_delivery') return 'seller_delivery';
  if (fulfillmentType === 'delivery' && (deliveryHandledBy === 'seller' || !deliveryHandledBy)) {
    return 'seller_delivery';
  }
  if (fulfillmentType === 'delivery' && deliveryHandledBy === 'platform') return 'cart_purchase';

  if (listingType) {
    // Thin read-through of listing → workflow (aligned with action_type map)
    if (listingType === 'contact_only') return 'contact_enquiry';
    return listingType;
  }

  return 'self_fulfillment';
}
