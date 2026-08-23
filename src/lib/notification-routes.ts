// @ts-nocheck
/**
 * Centralized notification-type → route resolver.
 * Used as fallback when `reference_path` is missing from a notification payload.
 */

function getOrderId(payload?: Record<string, any>): string | undefined {
  return payload?.order_id || payload?.orderId || payload?.entity_id;
}

/**
 * Seller-facing refund request → Disputes & Refunds on the seller dashboard.
 * Prefer this over buyer "My Orders" paths when payload marks the target as seller.
 */
export function sellerRefundDisputeRoute(
  payload?: Record<string, any> | null,
): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const status = String(payload.status || '').toLowerCase();
  const role = String(payload.target_role || '').toLowerCase();
  if (role !== 'seller') return null;
  if (status !== 'refund_requested' && status !== 'refund_request') return null;
  const refundId = payload.refundId || payload.refund_id;
  return refundId
    ? `/seller?tab=refunds&refundId=${encodeURIComponent(String(refundId))}`
    : '/seller?tab=refunds';
}

export function resolveNotificationRoute(
  type: string | undefined | null,
  payload?: Record<string, any>,
): string {
  if (!type) return '/notifications/inbox';

  const sellerRefundPath = sellerRefundDisputeRoute(payload);
  if (sellerRefundPath) return sellerRefundPath;

  switch (type) {
    // Seller lifecycle
    case 'seller_approved':
      return '/seller/credits';
    case 'seller_store_submitted':
    case 'seller_store_under_review':
      return '/become-seller';
    case 'seller_rejected':
      return '/become-seller';
    case 'seller_suspended':
      return '/seller';
    case 'seller_credit_failed':
    case 'seller_credit_refunded':
      return '/seller/credits';
    case 'seller_daily_summary':
      return '/seller';

    // Order lifecycle
    case 'order':
    case 'order_created':
    case 'order_status':
    case 'order_update':
    case 'order_lifecycle': {
      const orderId = getOrderId(payload);
      return orderId ? `/orders/${orderId}` : '/orders';
    }
    case 'seller_order_status_reminder': {
      const orderId = getOrderId(payload);
      return orderId ? `/orders/${orderId}` : '/seller';
    }

    // Reviews — buyer rates an order, seller views received review on the order page
    case 'review':
    case 'review_prompt':
    case 'review_received': {
      const orderId = getOrderId(payload);
      return orderId ? `/orders/${orderId}` : '/orders';
    }

    // Chat / messages — live in the order context (open chat sheet)
    case 'chat':
    case 'chat_message':
    case 'message': {
      const orderId = getOrderId(payload);
      return orderId ? `/orders/${orderId}?chat=1` : '/notifications/inbox';
    }

    // Product moderation
    case 'product_approved':
    case 'product_rejected':
      return '/seller';

    // Category request outcomes
    case 'category_request_approved':
    case 'category_request_rejected': {
      const cat = payload?.category;
      if (payload?.kind === 'subcategory' && cat) {
        return `/seller/products/new?category=${cat}${payload?.subcategory_id ? `&subcategory=${payload.subcategory_id}` : ''}`;
      }
      return '/seller/category-requests';
    }

    // License moderation
    case 'license_approved':
    case 'license_rejected':
      return '/seller';

    // Admin / moderation
    case 'moderation':
    case 'new_store_application':
      return '/admin';

    // Delivery lifecycle
    case 'delivery':
    case 'delivery_en_route':
    case 'delivery_proximity':
    case 'delivery_proximity_imminent':
    case 'delivery_stalled':
    case 'delivery_delayed': {
      const oid = getOrderId(payload);
      return oid ? `/orders/${oid}` : '/orders';
    }

    // Parcels
    case 'parcel':
      return '/parcels';

    // Booking reminders
    case 'booking_reminder_1_hour':
    case 'booking_reminder_30_min':
    case 'booking_reminder_10_min': {
      const orderId = getOrderId(payload);
      return orderId ? `/orders/${orderId}` : '/orders';
    }

    // Settlement / transfer (seller-facing) — wallet is the financial home
    case 'settlement':
    case 'seller_transfer':
    case 'seller_withdrawal':
      return '/seller/wallet';

    case 'seller_credit_purchased':
    case 'seller_credit_refunded':
    case 'seller_credit_low':
    case 'seller_credit_exhausted':
      return '/seller/credits';

    // Support tickets — deep-link into the order with the ticket id so the
    // seller (or buyer) lands somewhere real instead of a dead /support route.
    case 'support_ticket': {
      const orderId = getOrderId(payload);
      const ticketId = payload?.ticket_id || payload?.ticketId;
      if (orderId && ticketId) return `/orders/${orderId}?ticket=${ticketId}`;
      if (orderId) return `/orders/${orderId}`;
      if (payload?.target_role === 'seller') return '/seller';
      return '/notifications/inbox';
    }

    default:
      return '/notifications/inbox';
  }
}

/**
 * Known-dead reference_paths that historic DB rows may contain.
 * These should be ignored so the resolver can compute the correct route.
 */
const DEAD_ROUTE_PATTERNS: RegExp[] = [
  /^\/support(\/|$)/,
  /^\/seller\/dashboard$/,
  /^\/seller\/reviews$/,
  /^\/seller\/settlements$/,
];

/**
 * Pick the best route for a notification: prefer a valid `reference_path`,
 * otherwise fall back to the type-based resolver. Strips known-dead routes
 * from the DB so legacy notifications don't 404.
 */
export function pickNotificationRoute(n: {
  type?: string | null;
  reference_path?: string | null;
  action_url?: string | null;
  payload?: Record<string, any> | null;
  data?: Record<string, any> | null;
}): string {
  // Seller refund alerts must open Disputes & Refunds even when legacy rows
  // still store a buyer-style /orders/{id} reference_path.
  const payload = (n.payload || n.data || null) as Record<string, any> | null;
  const sellerRefundPath = sellerRefundDisputeRoute(payload);
  if (sellerRefundPath) return sellerRefundPath;

  const ref = (n.reference_path || n.action_url)?.trim();
  if (ref && ref.startsWith('/') && !DEAD_ROUTE_PATTERNS.some(re => re.test(ref))) {
    return ref;
  }
  return resolveNotificationRoute(n.type, payload || undefined);
}
