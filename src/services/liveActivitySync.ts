// @ts-nocheck
/**
 * Shared sync logic for Live Activity orchestration.
 * Extracted so it can be called from mount, resume, and polling fallback.
 */
import { supabase } from '@/integrations/supabase/client';
import { LiveActivityManager } from '@/services/LiveActivityManager';
import { buildLiveActivityData, type StatusFlowEntry } from '@/services/liveActivityMapper';
import { getTerminalStatuses } from '@/services/statusFlowCache';

const TAG = '[LA-Sync]';

/** Prevents concurrent syncActiveOrders calls from racing */
let syncing = false;

/** Cached status flow entries to avoid re-fetching on every sync */
let cachedFlowEntries: StatusFlowEntry[] | null = null;
let cacheExpiry = 0;

async function getStatusFlowEntries(): Promise<StatusFlowEntry[]> {
  // Force fresh fetch if cache is empty (first-load) or expired
  if (cachedFlowEntries && cachedFlowEntries.length > 0 && Date.now() < cacheExpiry) {
    return cachedFlowEntries;
  }
  const { data, error } = await supabase
    .from('category_status_flows')
    .select('status_key, display_label, sort_order, buyer_hint')
    .in('transaction_type', ['cart_purchase', 'seller_delivery'])
    .order('sort_order');

  if (error || !data || data.length === 0) {
    console.warn(TAG, 'Failed to fetch status flows, using empty:', error?.message);
    return cachedFlowEntries ?? [];
  }

  cachedFlowEntries = data as StatusFlowEntry[];
  cacheExpiry = Date.now() + 10 * 60 * 1000;
  return cachedFlowEntries;
}

export async function syncActiveOrders(userId: string): Promise<number> {
  if (syncing) {
    console.log(TAG, 'SKIP — sync already in progress');
    return 0;
  }
  syncing = true;
  try {
    console.log(TAG, 'Syncing active buyer orders for', userId);

    // Use terminal-exclusion (same as orchestrator heartbeat) to avoid divergence
    const terminalStatuses = [...await getTerminalStatuses()];
    if (terminalStatuses.length === 0) {
      console.warn(TAG, 'No terminal statuses from DB, skipping sync');
      return 0;
    }

    // Exclude terminal + payment_pending; add 2-hour recency guard
    const excludeStatuses = [...terminalStatuses, 'payment_pending'];
    const excludeFilter = `(${excludeStatuses.map(s => `"${s}"`).join(',')})`;
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, status, seller_id')
      .eq('buyer_id', userId)
      .not('status', 'in', excludeFilter)
      .gte('created_at', twoHoursAgo);

    if (error) {
      console.error(TAG, 'Failed to fetch active orders:', error.message);
      return 0;
    }

    if (!orders || orders.length === 0) {
      console.log(TAG, 'No active orders');
    }

    const activeOrderIds = new Set((orders ?? []).map((o) => o.id));

    // ── FIX 1: End native activities for orders that became terminal while backgrounded ──
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (Capacitor.isNativePlatform()) {
        const { LiveActivity } = await import('@/plugins/live-activity');
        const { activities: nativeActivities } = await LiveActivity.getActiveActivities();
        for (const act of nativeActivities) {
          if (!activeOrderIds.has(act.entityId)) {
            console.log(TAG, `Ending stale native activity for terminal order ${act.entityId}`);
            try {
              await LiveActivityManager.end(act.entityId);
            } catch (e) {
              console.warn(TAG, `Failed to end stale activity ${act.entityId}:`, e);
            }
          }
        }
      }
    } catch (e) {
      console.warn(TAG, 'Failed to clean up stale native activities:', e);
    }

    if (!orders || orders.length === 0) {
      return 0;
    }

    console.log(TAG, `Found ${orders.length} active order(s)`);

    const orderIds = orders.map((o) => o.id);
    const sellerIds = [...new Set(orders.map((o) => o.seller_id).filter(Boolean))];

    // Reuse the exclude filter for delivery exclusion (terminal statuses only for deliveries)
    const deliveryTerminalFilter = `(${[...terminalStatuses].map(s => `"${s}"`).join(',')})`;

    const [deliveriesResult, sellersResult, itemCountsResult, flowEntries] = await Promise.all([
      supabase
        .from('delivery_assignments')
        .select('order_id, eta_minutes, distance_meters, rider_name, rider_id')
        .in('order_id', orderIds)
        .not('status', 'in', deliveryTerminalFilter),
      sellerIds.length > 0
        ? supabase
            .from('seller_profiles')
            .select('id, business_name, profile_image_url')
            .in('id', sellerIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase
        .from('order_items')
        .select('order_id')
        .in('order_id', orderIds),
      getStatusFlowEntries(),
    ]);

    // Bug 4 fix: fetch vehicle_type from rider pool for assigned riders
    const riderIds = [...new Set(
      (deliveriesResult.data ?? []).map((d: any) => d.rider_id).filter(Boolean)
    )];
    let riderVehicleMap = new Map<string, string | null>();
    if (riderIds.length > 0) {
      try {
        const { data: riders } = await supabase
          .from('delivery_partner_pool')
          .select('id, vehicle_type')
          .in('id', riderIds);
        for (const r of (riders ?? [])) {
          riderVehicleMap.set(r.id, r.vehicle_type);
        }
      } catch { /* best-effort */ }
    }

    const deliveryMap = new Map(
      (deliveriesResult.data ?? []).map((d: any) => [d.order_id, d])
    );
    const sellerMap = new Map(
      (sellersResult.data ?? []).map((s: any) => [s.id, { name: s.business_name, logo: s.profile_image_url }])
    );
    // Count items per order
    const itemCountMap = new Map<string, number>();
    for (const item of (itemCountsResult.data ?? [])) {
      itemCountMap.set(item.order_id, (itemCountMap.get(item.order_id) ?? 0) + 1);
    }

    // Serialize push() calls to prevent hydration race conditions
    for (const order of orders) {
      const rawDelivery = deliveryMap.get(order.id) ?? null;
      // Enrich delivery with vehicle_type from rider pool
      const delivery = rawDelivery ? {
        ...rawDelivery,
        vehicle_type: rawDelivery.rider_id ? (riderVehicleMap.get(rawDelivery.rider_id) ?? null) : null,
      } : null;
      const sellerInfo = sellerMap.get(order.seller_id) as { name: string; logo: string | null } | null;
      const sellerName = sellerInfo?.name ?? null;
      const sellerLogo = sellerInfo?.logo ?? null;
      const itemCount = itemCountMap.get(order.id) ?? null;
      const data = buildLiveActivityData(order, delivery, sellerName, itemCount, flowEntries, sellerLogo, delivery?.eta_minutes ?? null);
      try {
        await LiveActivityManager.push(data);
      } catch (e) {
        console.error(TAG, `push() failed for order ${order.id}:`, e);
      }
    }

    return orders.length;
  } catch (e) {
    console.error(TAG, 'syncActiveOrders failed:', e);
    return 0;
  } finally {
    syncing = false;
  }
}
