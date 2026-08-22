/** Seller-ops noise hidden from the buyer-mode inbox. */
export const SELLER_OPERATIONAL_TYPES = [
  'settlement',
  'product_approved',
  'product_rejected',
  'license_approved',
  'license_rejected',
  'moderation',
  'seller_daily_summary',
] as const;

/**
 * Store/credit lifecycle events must remain in the bell even before the user
 * switches into seller mode (push may be missed or disabled).
 */
export const SELLER_LIFECYCLE_INBOX_TYPES = [
  'seller_approved',
  'seller_rejected',
  'seller_suspended',
  'seller_store_submitted',
  'seller_store_under_review',
  'seller_credit_purchased',
  'seller_credit_failed',
  'seller_credit_refunded',
] as const;

export const SELLER_ONLY_INBOX_FILTER = `(${SELLER_OPERATIONAL_TYPES.join(',')})`;

export const SELLER_LIFECYCLE_OR_FILTER =
  `type.in.(${SELLER_LIFECYCLE_INBOX_TYPES.join(',')}),data->>target_role.neq.seller,data->>target_role.is.null`;
