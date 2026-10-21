import { supabase } from '@/integrations/supabase/client';
import { computeStoreStatus, formatStoreClosedBuyerMessage } from '@/lib/store-availability';
import { canScheduleWhileClosed, isHardBlockedStore } from '@/lib/store-schedule';
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

export type ReorderStoreGate = {
  blocked: string | null;
  schedule: boolean;
};

/** Paused/vacation still block. Closed stores can reorder into the schedule cart. */
export async function inspectReorderStores(sellerIds: string[]): Promise<ReorderStoreGate> {
  const ids = [...new Set(sellerIds.filter(Boolean))];
  if (ids.length === 0) return { blocked: null, schedule: false };

  const { data: sellers } = await supabase
    .from('seller_profiles')
    .select('id, availability_start, availability_end, operating_days, is_available, vacation_mode')
    .in('id', ids);
  if (!sellers?.length) return { blocked: null, schedule: false };

  let schedule = false;
  for (const seller of sellers) {
    const vacation = !!(seller as { vacation_mode?: boolean | null }).vacation_mode;
    const status = computeStoreStatus(
      seller.availability_start,
      seller.availability_end,
      seller.operating_days,
      seller.is_available ?? true,
    );
    if (vacation) {
      return {
        blocked: 'This store is on a break. Scheduling is unavailable until it reopens.',
        schedule: false,
      };
    }
    if (isHardBlockedStore(status.status, vacation)) {
      return {
        blocked: formatStoreClosedBuyerMessage(status) || 'This store is currently paused.',
        schedule: false,
      };
    }
    if (canScheduleWhileClosed(status.status, vacation)) schedule = true;
  }
  return { blocked: null, schedule };
}

export async function getClosedStoreReorderMessage(sellerIds: string[]): Promise<string | null> {
  return (await inspectReorderStores(sellerIds)).blocked;
}
