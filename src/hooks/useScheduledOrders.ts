// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { addDays, format } from 'date-fns';
import {
  groupUpcomingByDate,
  isDueForPreparation,
  isScheduledOrder,
  isUpcomingScheduled,
  resolveScheduledPhase,
  type ScheduledOrderLike,
} from '@/lib/scheduled-orders';

export type ScheduledOrderRow = ScheduledOrderLike & {
  id: string;
  total_amount?: number;
  status: string;
  seller_id?: string;
  buyer_id?: string;
  created_at?: string;
  buyer?: { name?: string | null } | null;
  seller?: { business_name?: string | null } | null;
  items?: { product_name?: string | null; quantity?: number }[];
};

async function fetchScheduledOrders(opts: {
  sellerId?: string | null;
  buyerId?: string | null;
}) {
  const from = format(new Date(), 'yyyy-MM-dd');
  const to = format(addDays(new Date(), 60), 'yyyy-MM-dd');

  let q = supabase
    .from('orders')
    .select(`
      id, status, scheduled_date, scheduled_time_start, scheduled_time,
      preparation_start_at, scheduled_fulfillment_at, cancellation_cutoff_at,
      total_amount, created_at, seller_id, buyer_id,
      buyer:profiles!orders_buyer_id_fkey(name),
      seller:seller_profiles!orders_seller_id_fkey(business_name),
      items:order_items(product_name, quantity)
    `)
    .not('scheduled_date', 'is', null)
    .gte('scheduled_date', from)
    .lte('scheduled_date', to)
    .in('status', ['placed', 'pending', 'accepted', 'confirmed', 'scheduled', 'requested', 'rescheduled'])
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time_start', { ascending: true });

  if (opts.sellerId) q = q.eq('seller_id', opts.sellerId);
  if (opts.buyerId) q = q.eq('buyer_id', opts.buyerId);

  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as ScheduledOrderRow[];
}

export function useScheduledOrders(opts: { sellerId?: string | null; buyerId?: string | null; enabled?: boolean }) {
  const enabled = opts.enabled !== false && !!(opts.sellerId || opts.buyerId);

  return useQuery({
    queryKey: ['scheduled-orders', opts.sellerId ?? null, opts.buyerId ?? null],
    enabled,
    queryFn: () => fetchScheduledOrders(opts),
    staleTime: 30_000,
    select: (rows) => {
      const upcoming = rows.filter(r => isScheduledOrder(r) && isUpcomingScheduled(r));
      const dueNow = rows.filter(r => isScheduledOrder(r) && isDueForPreparation(r));
      const dueToday = rows.filter(r => resolveScheduledPhase(r) === 'due_today');
      return {
        all: rows,
        upcoming,
        dueNow,
        dueToday,
        grouped: groupUpcomingByDate(upcoming),
        next: dueNow[0] ?? upcoming[0] ?? null,
      };
    },
  });
}
