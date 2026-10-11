import { extrasFromCartItems, type SelectedExtra } from '@/lib/productExtras';

type PayloadItem = {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  selected_extras?: unknown;
  variant?: { label?: string | null } | null;
  product?: { name?: string | null; price?: number | null } | null;
};

type PayloadGroup = { sellerId: string; subtotal: number; items: PayloadItem[] };

function lineExtras(item: PayloadItem): SelectedExtra[] {
  return Array.isArray(item.selected_extras) ? (item.selected_extras as SelectedExtra[]) : [];
}

/** Buyer instructions plus the add-ons of the given lines, as one order note. */
export function checkoutNotes(items: PayloadItem[], buyerNotes: string | null | undefined): string | null {
  const extras = extrasFromCartItems(items.map((item) => ({ ...item, selected_extras: lineExtras(item) })));
  return [extras, buyerNotes?.trim()].filter(Boolean).join('\n\n') || null;
}

/** Seller groups for create_multi_vendor_orders; each store gets only its own add-ons. */
export function buildSellerGroupsPayload(groups: PayloadGroup[], buyerNotes: string | null | undefined) {
  return groups.map((group) => ({
    seller_id: group.sellerId,
    subtotal: group.subtotal,
    notes: checkoutNotes(group.items, buyerNotes) ?? '',
    items: group.items.map((item) => ({
      product_id: item.product_id,
      product_name: item.product?.name || 'Unknown',
      quantity: item.quantity,
      unit_price: item.product?.price || 0,
      ...(item.variant_id ? { variant_id: item.variant_id } : {}),
      selected_extras: lineExtras(item),
    })),
  }));
}
