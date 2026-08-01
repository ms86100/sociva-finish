// @ts-nocheck
import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getTerminalStatuses, invalidateStatusFlowCache } from '@/services/statusFlowCache';
import { ChevronRight, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { jitteredStaleTime } from '@/lib/query-utils';
import { compactETA } from '@/lib/etaEngine';
import { getTransitStatuses } from '@/lib/visibilityEngine';

function CompactCountdown({ autoCancelAt, onExpire }: { autoCancelAt: string; onExpire?: () => void }) {
  const calc = useCallback(() => {
    const diff = new Date(autoCancelAt).getTime() - Date.now();
    return Math.max(0, Math.floor(diff / 1000));
  }, [autoCancelAt]);
  const [secs, setSecs] = useState(calc);
  const expiredRef = useRef(false);
  useEffect(() => {
    setSecs(calc());
    expiredRef.current = false;
    const t = setInterval(() => {
      const v = calc();
      setSecs(v);
      if (v <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [calc, onExpire]);
  if (secs <= 0) return <span className="text-[10px] font-bold text-destructive whitespace-nowrap">Expired</span>;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  const isLow = secs <= 60;
  return (
    <span className={`text-[10px] font-bold font-mono whitespace-nowrap flex items-center gap-0.5 ${isLow ? 'text-destructive' : 'text-warning'}`}>
      <Clock size={10} />
      {m}:{s.toString().padStart(2, '0')}
    </span>
  );
}

interface ActiveOrder {
  id: string;
  status: string;
  created_at: string;
  estimated_delivery_at: string | null;
  auto_cancel_at: string | null;
  seller_name: string;
  item_count: number;
  display_label: string | null;
  color: string | null;
  icon: string | null;
  first_product_image: string | null;
}

export function ActiveOrderStrip() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: activeOrders = [] } = useQuery({
    queryKey: ['active-orders-strip', user?.id],
    queryFn: async (): Promise<ActiveOrder[]> => {
      if (!user?.id) return [];

      // Perf: fetch terminal statuses inside queryFn to eliminate sequential waterfall
      const terminalSet = await getTerminalStatuses().catch(() => new Set<string>());
      const terminalArr = [...terminalSet];
      // Also exclude payment_pending — these are unpaid orders not yet visible to sellers
      const excludeStatuses = [...terminalArr, 'payment_pending'];

      // 24-hour age cap — orders older than this are stale test data
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, status, created_at, estimated_delivery_at, auto_cancel_at,
          seller:seller_profiles!orders_seller_id_fkey(business_name),
          order_items(id, product:products(image_url))
        `)
        .eq('buyer_id', user.id)
        .not('status', 'in', `(${excludeStatuses.map(s => `"${s}"`).join(',')})`)
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        console.warn('[ActiveOrderStrip] Query error:', error.message);
        if (error.code === '22P02') {
          invalidateStatusFlowCache();
        }
        return [];
      }
      if (!data) return [];

      const statusKeys = [...new Set(data.map((o: any) => o.status))];
      // Fetch display data for all workflow types — no hardcoded list
      const { data: flowData } = await supabase
        .from('category_status_flows')
        .select('status_key, display_label, color, icon, transaction_type')
        .in('status_key', statusKeys);

      const flowMap = new Map<string, { display_label: string | null; color: string | null; icon: string | null }>();
      for (const f of (flowData || []) as any[]) {
        if (!flowMap.has(f.status_key)) {
          flowMap.set(f.status_key, { display_label: f.display_label, color: f.color, icon: f.icon });
        }
      }

      return data.map((o: any) => {
        const flow = flowMap.get(o.status);
        const firstImage = o.order_items?.find((oi: any) => oi.product?.image_url)?.product?.image_url || null;
        return {
          id: o.id,
          status: o.status,
          created_at: o.created_at,
          estimated_delivery_at: o.estimated_delivery_at,
          auto_cancel_at: o.auto_cancel_at || null,
          seller_name: o.seller?.business_name || '',
          item_count: o.order_items?.length || 0,
          display_label: flow?.display_label || o.status.replace(/_/g, ' '),
          color: flow?.color || null,
          icon: flow?.icon || null,
          first_product_image: firstImage,
        };
      });
    },
    enabled: !!user?.id,
    staleTime: jitteredStaleTime(30_000),
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });

  // Realtime: subscribe to order updates — composite dedup key prevents duplicate processing
  const lastEventRef = useRef<string>('');
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`active-strip:${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `buyer_id=eq.${user.id}`,
      }, (payload) => {
        const row = payload.new as any;
        const eventKey = `${row?.id}:${row?.status}:${row?.updated_at}`;
        if (eventKey === lastEventRef.current) return;
        lastEventRef.current = eventKey;
        queryClient.invalidateQueries({ queryKey: ['active-orders-strip'] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient]);

  useEffect(() => {
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['active-orders-strip'] });
    };
    window.addEventListener('order-terminal-push', handler);
    return () => window.removeEventListener('order-terminal-push', handler);
  }, [queryClient]);

  // Delayed appearance — don't block above-fold marketplace content
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (activeOrders.length === 0) { setVisible(false); return; }
    const t = setTimeout(() => setVisible(true), 500);
    return () => clearTimeout(t);
  }, [activeOrders.length]);

  if (activeOrders.length === 0 || !visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="mt-2 px-4"
    >
      {activeOrders.length > 1 && (
        <p className="text-[10px] text-muted-foreground mb-1 font-medium">{activeOrders.length} active orders</p>
      )}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        <AnimatePresence>
          {activeOrders.map((order) => {
            const isTransit = getTransitStatuses().has(order.status);
            const hasEta = !!order.estimated_delivery_at;
            const etaText = hasEta ? compactETA(order.estimated_delivery_at!) : null;
            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={() => navigate(`/orders/${order.id}`)}
                className="flex items-center gap-2 rounded-xl bg-primary/[0.06] backdrop-blur-lg backdrop-saturate-150 border border-primary/[0.1] px-2.5 py-2 cursor-pointer active:scale-[0.97] transition-transform shrink-0 min-w-0"
                style={{ maxWidth: activeOrders.length === 1 ? '100%' : '55vw' }}
              >
                {/* Thumbnail */}
                <div className="w-9 h-9 rounded-xl bg-primary/10 shrink-0 overflow-hidden flex items-center justify-center">
                  {order.first_product_image ? (
                    <img src={order.first_product_image} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-sm">📦</span>
                  )}
                </div>

                {/* Status + seller */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isTransit && (
                      <motion.span
                        className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                      />
                    )}
                    <span className="text-xs font-semibold text-foreground truncate">
                      {order.display_label}
                    </span>
                  </div>
                  {order.seller_name && (
                    <span className="text-[10px] text-muted-foreground truncate block">
                      {order.seller_name}
                    </span>
                  )}
                </div>

                {/* ETA / countdown / count */}
                <div className="shrink-0 flex items-center gap-1">
                  {order.auto_cancel_at && order.status === 'placed' ? (
                    <CompactCountdown autoCancelAt={order.auto_cancel_at} onExpire={() => queryClient.invalidateQueries({ queryKey: ['active-orders-strip'] })} />
                  ) : etaText ? (
                    <span className="text-[10px] font-bold text-primary whitespace-nowrap">
                      {etaText}
                    </span>
                  ) : order.item_count > 0 ? (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      {order.item_count} item{order.item_count > 1 ? 's' : ''}
                    </span>
                  ) : null}
                  <ChevronRight size={14} className="text-muted-foreground/40 shrink-0" />
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
