// @ts-nocheck
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSellerContext } from '@/contexts/AuthContext';

// Seller-only notification types — only relevant in seller mode
const SELLER_ONLY_TYPES = [
  'settlement',
  'seller_approved',
  'seller_rejected',
  'seller_suspended',
  'product_approved',
  'product_rejected',
  'license_approved',
  'license_rejected',
  'moderation',
  'seller_daily_summary',
] as const;

const SELLER_ONLY_FILTER = `(${SELLER_ONLY_TYPES.join(',')})`;

export interface NotificationPayload {
  action?: string;
  reference_path?: string;
  order_id?: string;
  orderId?: string;
  target_role?: string;
  [key: string]: unknown;
}

export interface UserNotification {
  id: string;
  title: string;
  body: string;
  type: string;
  action_url: string | null;
  is_read: boolean;
  created_at: string;
  data: NotificationPayload | null;
  // Convenience aliases so downstream components can use either name
  get reference_path(): string | null;
  get payload(): NotificationPayload | null;
}

/** Wrap raw DB rows so legacy `.reference_path` / `.payload` still work.
 *  Self-heals: ensures `data` is always an object so `data?.action` never throws. */
function wrapNotification(row: any): UserNotification {
  const safe = { ...row };
  // Coerce data to {} when null so downstream `data?.x` accesses are stable
  if (safe.data == null) safe.data = {};
  return Object.defineProperties(safe, {
    reference_path: { get() { return this.action_url; }, enumerable: false },
    payload: { get() { return this.data; }, enumerable: false },
  }) as UserNotification;
}

function wrapNotifications(rows: any[]): UserNotification[] {
  return (rows || []).map(wrapNotification);
}

const PAGE_SIZE = 30;

/**
 * Fire-and-forget stale cleanup — never throws, never blocks reads.
 */
export async function cleanupStaleDeliveryNotifications(notifications: UserNotification[]) {
  try {
    const staleEligibleTypes = new Set([
      'delivery_delayed', 'delivery_stalled', 'delivery_en_route', 'delivery_proximity', 'delivery_proximity_imminent',
      'order_status', 'order_update', 'order_placed', 'order_confirmed', 'order_preparing', 'order_ready',
      'order',
    ]);
    const unreadDeliveryNotifs: UserNotification[] = [];
    const orderIds = new Set<string>();
    for (const n of notifications) {
      if (!n.is_read && staleEligibleTypes.has(n.type)) {
        const d = n.data || n.payload;
        const oid = (d as any)?.orderId || (d as any)?.order_id || (d as any)?.entity_id || (n.action_url || n.reference_path)?.split('/orders/')?.[1];
        if (oid) {
          orderIds.add(oid);
          unreadDeliveryNotifs.push(n);
        }
      }
    }
    if (orderIds.size === 0) return;

    const { data: terminalOrders } = await supabase
      .from('orders')
      .select('id')
      .in('id', [...orderIds])
      .in('status', ['delivered', 'completed', 'cancelled', 'no_show']);
    if (!terminalOrders || terminalOrders.length === 0) return;

    const terminalSet = new Set(terminalOrders.map((o: any) => o.id));
    const staleIds = unreadDeliveryNotifs
      .filter(n => {
        const d = n.data || n.payload;
        const oid = (d as any)?.orderId || (d as any)?.order_id || (d as any)?.entity_id || (n.action_url || n.reference_path)?.split('/orders/')?.[1];
        return oid && terminalSet.has(oid);
      })
      .map(n => n.id);
    if (staleIds.length > 0) {
      await supabase.from('user_notifications').update({ is_read: true }).in('id', staleIds);
    }
  } catch (e) {
    console.warn('[useNotifications] Stale cleanup failed (non-blocking):', e);
  }
}

export function useNotifications(userId: string | undefined) {
  let isSeller = false;
  try { isSeller = useSellerContext().isSeller; } catch { /* outside provider */ }

  return useInfiniteQuery({
    queryKey: ['notifications', userId, isSeller ? 'seller' : 'buyer'],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      let query = supabase
        .from('user_notifications')
        .select('id, title, body, type, action_url, is_read, created_at, data')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);

      if (!isSeller) {
        // Buyer mode: hide seller-only types and seller-targeted notifications
        query = query
          .not('type', 'in', SELLER_ONLY_FILTER)
          .not('data->>target_role', 'eq', 'seller');
      }
      // Seller mode: show everything (both buyer & seller notifications for this user)

      if (pageParam) {
        query = query.lt('created_at', pageParam);
      }

      const { data, error } = await query;
      if (error) console.warn('[Inbox] query error:', error.message);
      const wrapped = wrapNotifications(data);
      console.log(`[Inbox] fetched ${wrapped.length} notifications (mode=${isSeller ? 'seller' : 'buyer'})`);
      return wrapped;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1]?.created_at;
    },
    enabled: !!userId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}


export function useLatestActionNotification(userId: string | undefined) {
  let isSeller = false;
  try { isSeller = useSellerContext().isSeller; } catch { /* outside provider */ }

  return useQuery({
    queryKey: ['latest-action-notification', userId, isSeller ? 'seller' : 'buyer'],
    queryFn: async () => {
      let query = supabase
        .from('user_notifications')
        .select('id, title, body, type, action_url, is_read, created_at, data')
        .eq('user_id', userId!)
        .eq('is_read', false)
        .not('data', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!isSeller) {
        query = query
          .not('type', 'in', SELLER_ONLY_FILTER)
          .not('data->>target_role', 'eq', 'seller');
      }

      const { data } = await query;
      const notifications = wrapNotifications(data);
      if (notifications.length === 0) return null;

      // Collect order-linked notifications for recency gating
      const orderIds = new Set<string>();
      for (const n of notifications) {
        const d = n.data;
        const oid = d?.orderId || d?.order_id || (n.action_url)?.split('/orders/')?.[1];
        if (oid) orderIds.add(oid);
      }

      let terminalOrderIds = new Set<string>();
      const staleOrderIds = new Set<string>();
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      if (orderIds.size > 0) {
        const [terminalRes, ageRes] = await Promise.all([
          supabase
            .from('orders')
            .select('id')
            .in('id', [...orderIds])
            .in('status', ['delivered', 'completed', 'cancelled', 'no_show']),
          supabase
            .from('orders')
            .select('id')
            .in('id', [...orderIds])
            .lt('created_at', twentyFourHoursAgo),
        ]);
        if (terminalRes.data) {
          terminalOrderIds = new Set(terminalRes.data.map((o: any) => o.id));
        }
        if (ageRes.data) {
          for (const o of ageRes.data) staleOrderIds.add(o.id);
        }
      }

      for (const n of notifications) {
        const d = n.data;
        const linkedOid = d?.orderId || d?.order_id || (n.action_url)?.split('/orders/')?.[1];
        if (linkedOid && (terminalOrderIds.has(linkedOid) || staleOrderIds.has(linkedOid))) continue;
        // Chat notifications: force "Reply" action and ?chat=1 deep link.
        if (n.type === 'chat' || n.type === 'message') {
          const oid = linkedOid;
          return wrapNotification({
            ...n,
            action_url: oid ? `/orders/${oid}?chat=1` : (n.action_url || null),
            data: { ...n.data, action: 'reply' },
          });
        }
        if (d?.action) return n;
        if (n.action_url?.startsWith('/orders/')) {
          return wrapNotification({
            ...n,
            data: { ...n.data, action: 'View Order' },
          });
        }
      }
      return null;
    },
    enabled: !!userId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('user_notifications').update({ is_read: true }).eq('id', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      await supabase.from('user_notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
    },
  });
}
