import {
  formatScheduledGlance,
  isScheduledOrder,
  type ScheduledOrderLike,
} from '@/lib/scheduled-orders';

export type OrderGlanceItem = {
  product_name?: string | null;
  quantity?: number | null;
};

export type SellerWhenGlance = {
  kind: 'instant' | 'preorder';
  label: string;
};

/** Compact "Biryani 2x, Kebab 2x" line so sellers do not have to open the order. */
export function formatOrderItemsGlance(
  items: OrderGlanceItem[] | null | undefined,
  maxNames = 4,
): string {
  const rows = Array.isArray(items) ? items : [];
  const qtyByName = new Map<string, number>();
  const nameOrder: string[] = [];

  for (const item of rows) {
    const name = (item.product_name || 'Item').trim() || 'Item';
    const qty = Number(item.quantity);
    const add = Number.isFinite(qty) && qty > 0 ? qty : 1;
    if (!qtyByName.has(name)) nameOrder.push(name);
    qtyByName.set(name, (qtyByName.get(name) || 0) + add);
  }

  if (nameOrder.length === 0) return '';

  const visible = nameOrder.slice(0, Math.max(1, maxNames));
  const shown = visible.map((name) => {
    const qty = qtyByName.get(name) || 1;
    const qtyLabel = Number.isInteger(qty) ? String(qty) : String(qty);
    return `${name} ${qtyLabel}x`;
  });
  const extra = nameOrder.length - visible.length;
  return extra > 0 ? `${shown.join(', ')} +${extra} more` : shown.join(', ');
}

export function formatSellerWhenGlance(order: (ScheduledOrderLike & { order_type?: string | null }) | null | undefined): SellerWhenGlance {
  if (!isScheduledOrder(order)) {
    return { kind: 'instant', label: 'Instant' };
  }
  const when = formatScheduledGlance(order);
  const kindLabel = order?.order_type === 'booking' ? 'Scheduled' : 'Pre-order';
  return { kind: 'preorder', label: when ? `${kindLabel} · ${when}` : kindLabel };
}

export function formatSellerOrderLocation(input: {
  delivery_address?: string | null;
  buyer?: {
    phase?: string | null;
    block?: string | null;
    flat_number?: string | null;
  } | null;
}): string | null {
  const addr = input.delivery_address?.trim();
  if (addr) return addr;

  const buyer = input.buyer;
  if (!buyer) return null;

  const phase = buyer.phase?.trim();
  const block = buyer.block?.trim();
  const flat = buyer.flat_number?.trim();
  const parts: string[] = [];
  if (phase) parts.push(phase);
  if (block && flat) parts.push(`Block ${block}, ${flat}`);
  else if (block) parts.push(`Block ${block}`);
  else if (flat) parts.push(flat);
  return parts.length ? parts.join(' · ') : null;
}
