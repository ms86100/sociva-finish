/**
 * Buyer-facing checkout group helpers — one purchase → N seller child orders.
 * Pure mappers (no I/O) so list/detail UI and tests stay deterministic.
 */

export type CheckoutChildOrder = {
  id: string;
  checkout_group_id?: string | null;
  idempotency_key?: string | null;
  created_at: string;
  status: string;
  payment_status?: string | null;
  payment_type?: string | null;
  total_amount: number;
  fulfillment_type?: string | null;
  seller_id?: string | null;
  seller?: { business_name?: string | null; cover_image_url?: string | null } | null;
  items?: Array<{
    id?: string;
    product_name?: string | null;
    quantity?: number;
    product_image?: string | null;
  }> | null;
};

export type BuyerCheckoutListItem =
  | { kind: 'single'; order: CheckoutChildOrder }
  | { kind: 'group'; groupId: string; orders: CheckoutChildOrder[]; createdAt: string };

/** Strip trailing :segment from CMVO soft keys (checkoutKey:1 → checkoutKey). */
export function checkoutKeyPrefix(idempotencyKey: string | null | undefined): string | null {
  if (!idempotencyKey) return null;
  const idx = idempotencyKey.lastIndexOf(':');
  if (idx <= 0) return null;
  return idempotencyKey.slice(0, idx);
}

/**
 * Buyer-facing status for a single store portion of a multi-seller checkout.
 */
export function buyerStoreStatusLabel(
  status: string,
  paymentStatus?: string | null,
  opts?: { failureOwner?: string | null; rejectionReason?: string | null },
): string {
  const s = (status || '').toLowerCase();
  const pay = (paymentStatus || '').toLowerCase();

  if (s === 'payment_pending' || (s === 'placed' && pay === 'pending' && false)) {
    return 'Payment incomplete';
  }
  if (s === 'payment_pending') return 'Payment incomplete';
  if (pay === 'failed') return 'Payment failed';
  if (pay.startsWith('refund')) {
    if (pay === 'refunded') return 'Refunded';
    return 'Refund in progress';
  }
  if (s === 'rejected') return 'Rejected by store';
  if (s === 'cancelled') {
    const reason = (opts?.rejectionReason || '').toLowerCase();
    const owner = (opts?.failureOwner || '').toLowerCase();
    if (owner === 'buyer' || reason.includes('cancelled by buyer')) return 'Cancelled by you';
    if (owner === 'seller' || owner === 'platform' || reason.includes('seller')) {
      return 'Rejected by store';
    }
    return 'Cancelled';
  }
  if (s === 'placed' || s === 'pending') return 'Waiting for seller';
  if (['accepted', 'preparing', 'booked', 'in_progress'].includes(s)) {
    if (s === 'accepted') return 'Accepted';
    if (s === 'preparing' || s === 'in_progress') return 'Preparing';
    return 'Accepted';
  }
  if (['ready', 'ready_for_pickup'].includes(s)) return 'Ready';
  if (['out_for_delivery', 'on_the_way', 'en_route', 'picked_up', 'assigned', 'at_gate', 'arrived', 'in_transit'].includes(s)) {
    return 'On the way';
  }
  if (['delivered', 'completed', 'picked_up_by_buyer', 'awaiting_cod'].includes(s)) {
    if (s === 'awaiting_cod') return 'Delivered · pay cash';
    return 'Completed';
  }
  return status.replace(/_/g, ' ');
}

export function groupSummaryLabel(orders: CheckoutChildOrder[]): string {
  if (orders.length === 0) return 'No stores';
  if (orders.length === 1) return buyerStoreStatusLabel(orders[0].status, orders[0].payment_status);

  const labels = orders.map((o) => buyerStoreStatusLabel(o.status, o.payment_status));
  const unique = new Set(labels);
  if (unique.size === 1) return `${orders.length} stores · ${labels[0]}`;

  const waiting = labels.filter((l) => l === 'Waiting for seller').length;
  const accepted = labels.filter((l) => l === 'Accepted' || l === 'Preparing' || l === 'On the way' || l === 'Ready').length;
  const rejected = labels.filter((l) => l === 'Rejected by store' || l === 'Cancelled' || l === 'Cancelled by you').length;
  const done = labels.filter((l) => l === 'Completed' || l.startsWith('Refund')).length;

  const parts: string[] = [];
  if (accepted) parts.push(`${accepted} active`);
  if (waiting) parts.push(`${waiting} waiting`);
  if (rejected) parts.push(`${rejected} cancelled`);
  if (done) parts.push(`${done} done`);
  return `${orders.length} stores · ${parts.join(' · ') || 'Mixed status'}`;
}

export function sumOrderAmounts(orders: CheckoutChildOrder[]): number {
  return orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
}

/**
 * Collapse flat buyer order rows into list items.
 * Prefers checkout_group_id; falls back to idempotency_key prefix for soft-linked history.
 */
export function groupBuyerOrdersForList(orders: CheckoutChildOrder[]): BuyerCheckoutListItem[] {
  const byGroup = new Map<string, CheckoutChildOrder[]>();
  const singles: CheckoutChildOrder[] = [];
  const softBuckets = new Map<string, CheckoutChildOrder[]>();

  for (const order of orders) {
    if (order.checkout_group_id) {
      const list = byGroup.get(order.checkout_group_id) || [];
      list.push(order);
      byGroup.set(order.checkout_group_id, list);
      continue;
    }
    const prefix = checkoutKeyPrefix(order.idempotency_key);
    if (prefix) {
      const list = softBuckets.get(prefix) || [];
      list.push(order);
      softBuckets.set(prefix, list);
      continue;
    }
    singles.push(order);
  }

  const items: BuyerCheckoutListItem[] = [];

  for (const [groupId, kids] of byGroup) {
    kids.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (kids.length === 1) {
      items.push({ kind: 'single', order: kids[0] });
    } else {
      items.push({
        kind: 'group',
        groupId,
        orders: kids,
        createdAt: kids[0].created_at,
      });
    }
  }

  for (const [prefix, kids] of softBuckets) {
    kids.sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (kids.length === 1) {
      items.push({ kind: 'single', order: kids[0] });
    } else {
      items.push({
        kind: 'group',
        groupId: `soft:${prefix}`,
        orders: kids,
        createdAt: kids[0].created_at,
      });
    }
  }

  for (const order of singles) {
    items.push({ kind: 'single', order });
  }

  items.sort((a, b) => {
    const aTs = a.kind === 'single' ? a.order.created_at : a.createdAt;
    const bTs = b.kind === 'single' ? b.order.created_at : b.createdAt;
    return bTs.localeCompare(aTs);
  });

  return items;
}

/** Resolve navigation target after placing N orders. */
export function postCheckoutPath(
  orderIds: string[],
  checkoutGroupId?: string | null,
): { path: string; state: Record<string, unknown> } {
  if (checkoutGroupId && orderIds.length > 1) {
    return {
      path: `/checkouts/${checkoutGroupId}`,
      state: { fromCheckout: true, orderCount: orderIds.length, orderIds },
    };
  }
  if (orderIds.length > 1 && !checkoutGroupId) {
    return {
      path: `/orders/${orderIds[0]}`,
      state: { fromCheckout: true, orderCount: orderIds.length, orderIds, showSiblings: true },
    };
  }
  return {
    path: `/orders/${orderIds[0]}`,
    state: { fromCheckout: true, orderCount: orderIds.length || 1, orderIds },
  };
}
