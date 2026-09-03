import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const SIBLING_SELECT = `
  id, created_at, status, payment_status, payment_type, total_amount,
  fulfillment_type, checkout_group_id, idempotency_key, seller_id,
  failure_owner, rejection_reason,
  seller:seller_profiles!orders_seller_id_fkey(business_name, cover_image_url),
  items:order_items(id, product_name, quantity, unit_price, subtotal, product_image)
`;

export function useCheckoutGroup(groupId: string | undefined, buyerId: string | undefined) {
  return useQuery({
    queryKey: ['checkout-group', groupId, buyerId],
    enabled: !!groupId && !!buyerId && !String(groupId).startsWith('soft:'),
    staleTime: 30_000,
    queryFn: async () => {
      const { data: group, error: gErr } = await supabase
        .from('checkout_groups' as any)
        .select('*')
        .eq('id', groupId!)
        .eq('buyer_id', buyerId!)
        .maybeSingle();
      if (gErr) throw gErr;

      const { data: orders, error: oErr } = await supabase
        .from('orders')
        .select(SIBLING_SELECT)
        .eq('checkout_group_id', groupId!)
        .eq('buyer_id', buyerId!)
        .order('created_at', { ascending: true });
      if (oErr) throw oErr;

      return {
        group: group as any,
        orders: (orders || []) as any[],
      };
    },
  });
}

/** Sibling seller orders for the same checkout (by group id or soft key). */
export function useCheckoutSiblings(opts: {
  orderId?: string;
  checkoutGroupId?: string | null;
  idempotencyKey?: string | null;
  buyerId?: string;
  enabled?: boolean;
}) {
  const { orderId, checkoutGroupId, idempotencyKey, buyerId, enabled = true } = opts;

  return useQuery({
    queryKey: ['checkout-siblings', orderId, checkoutGroupId, idempotencyKey, buyerId],
    enabled: enabled && !!buyerId && (!!checkoutGroupId || !!idempotencyKey),
    staleTime: 30_000,
    queryFn: async () => {
      if (checkoutGroupId && !String(checkoutGroupId).startsWith('soft:')) {
        const { data, error } = await supabase
          .from('orders')
          .select(SIBLING_SELECT)
          .eq('checkout_group_id', checkoutGroupId)
          .eq('buyer_id', buyerId!)
          .order('created_at', { ascending: true });
        if (error) throw error;
        return (data || []) as any[];
      }

      const prefix = idempotencyKey?.includes(':')
        ? idempotencyKey.slice(0, idempotencyKey.lastIndexOf(':'))
        : null;
      if (!prefix) return [];

      const { data, error } = await supabase
        .from('orders')
        .select(SIBLING_SELECT)
        .eq('buyer_id', buyerId!)
        .like('idempotency_key', `${prefix}:%`)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export async function resolveCheckoutGroupId(orderIds: string[]): Promise<string | null> {
  if (!orderIds.length) return null;
  const { data, error } = await supabase.rpc('get_checkout_group_id_for_orders' as any, {
    _order_ids: orderIds,
  });
  if (!error && data) return data as string;

  const { data: row } = await supabase
    .from('orders')
    .select('checkout_group_id')
    .eq('id', orderIds[0])
    .maybeSingle();
  return (row as any)?.checkout_group_id || null;
}
