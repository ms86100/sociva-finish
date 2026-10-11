import { supabase } from '@/integrations/supabase/client';
import { computeStoreStatus, formatStoreClosedBuyerMessage } from '@/lib/store-availability';
import { remapMergedLines } from '@/lib/product-merges';

export type ReorderLine = {
  product_id: string;
  quantity: number;
  variant_id?: string | null;
  unit_price?: number | null;
};

type OrderLineLike = {
  product_id?: string | null;
  quantity?: number | null;
  variant_id?: string | null;
  unit_price?: number | null;
};

function toReorderLines(rows: OrderLineLike[]): ReorderLine[] {
  return (rows || [])
    .filter((item) => item.product_id)
    .map((item) => ({
      product_id: item.product_id as string,
      quantity: Math.max(1, Number(item.quantity) || 1),
      ...(item.variant_id ? { variant_id: item.variant_id, unit_price: item.unit_price == null ? null : Number(item.unit_price) } : {}),
    }));
}

/**
 * Prefer lines already on the order object; fetch them if the list query omitted product_id,
 * or if a listed product sells by size (order screens load order_items without the size column).
 * Lines for listings that were grouped into sizes are pointed at the product and size now sold.
 */
export async function resolveReorderLines(
  orderItems: OrderLineLike[],
  orderId?: string | null,
  sizedProductIds?: ReadonlySet<string>,
): Promise<ReorderLine[]> {
  const fromItems = toReorderLines(orderItems);
  const needsSizes = !!sizedProductIds && fromItems.some((l) => !l.variant_id && sizedProductIds.has(l.product_id));
  if (fromItems.length > 0 && !needsSizes) return remapMergedLines(fromItems);
  if (!orderId) return remapMergedLines(fromItems);

  const { data, error } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);
  if (error || !data) return remapMergedLines(fromItems);
  const fetched = toReorderLines(data as OrderLineLike[]);
  return remapMergedLines(fetched.length > 0 ? fetched : fromItems);
}

export async function getClosedStoreReorderMessage(sellerIds: string[]): Promise<string | null> {
  const ids = [...new Set(sellerIds.filter(Boolean))];
  if (ids.length === 0) return null;

  const { data: sellers } = await supabase
    .from('seller_profiles')
    .select('id, availability_start, availability_end, operating_days, is_available')
    .in('id', ids);
  if (!sellers?.length) return null;

  for (const seller of sellers) {
    const status = computeStoreStatus(
      seller.availability_start,
      seller.availability_end,
      seller.operating_days,
      seller.is_available ?? true,
    );
    if (status.status !== 'open') {
      return formatStoreClosedBuyerMessage(status);
    }
  }
  return null;
}
