import { supabase } from '@/integrations/supabase/client';
import { computeStoreStatus, formatStoreClosedBuyerMessage } from '@/lib/store-availability';

export type ReorderLine = { product_id: string; quantity: number };

/** Prefer lines already on the order object; fetch product_id if the list query omitted it. */
export async function resolveReorderLines(
  orderItems: Array<{ product_id?: string | null; quantity?: number | null }>,
  orderId?: string | null,
): Promise<ReorderLine[]> {
  const fromItems = (orderItems || [])
    .filter((item) => item.product_id)
    .map((item) => ({
      product_id: item.product_id as string,
      quantity: Math.max(1, Number(item.quantity) || 1),
    }));
  if (fromItems.length > 0) return fromItems;
  if (!orderId) return [];

  const { data, error } = await supabase
    .from('order_items')
    .select('product_id, quantity')
    .eq('order_id', orderId);
  if (error || !data) return [];
  return data
    .filter((item) => item.product_id)
    .map((item) => ({
      product_id: item.product_id as string,
      quantity: Math.max(1, Number(item.quantity) || 1),
    }));
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
