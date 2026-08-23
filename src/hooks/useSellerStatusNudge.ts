// @ts-nocheck
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { hapticNotification, hapticVibrate } from '@/lib/haptics';
import type { NewOrder } from '@/hooks/useNewOrderAlert';
import {
  scheduleIncomingOrderLocalNotification,
  cancelIncomingOrderLocalNotification,
} from '@/lib/local-order-notifications';

const NUDGE_INTERVAL_MS = 5 * 60 * 1000;
const BELL_SOUND_CANDIDATES = ['/sounds/gate_bell.mp3', '/sounds/order_ring.mp3'];
const BELL_LOOP_GAP_MS = 1500;

function nudgeBucket(): number {
  return Math.floor(Date.now() / NUDGE_INTERVAL_MS);
}

export function useSellerStatusNudge(sellerIds: string[], paused: boolean) {
  const [pendingNudges, setPendingNudges] = useState<NewOrder[]>([]);
  const sellerIdsRef = useRef<Set<string>>(new Set());
  const shownBucketsRef = useRef<Set<string>>(new Set());
  const snoozedUntilRef = useRef<Record<string, number>>({});
  const dismissedRef = useRef<Set<string>>(new Set());
  const pendingRef = useRef<NewOrder[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const bellLoopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBuzzingRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useMemo(() => { sellerIdsRef.current = new Set(sellerIds); }, [sellerIds]);
  const enabled = sellerIds.length > 0 && !paused;

  useEffect(() => { pendingRef.current = pendingNudges; }, [pendingNudges]);

  const ensureAudioLoaded = useCallback(async () => {
    if (audioBufferRef.current) return true;
    try {
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      for (const url of BELL_SOUND_CANDIDATES) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          audioBufferRef.current = await ctx.decodeAudioData(await response.arrayBuffer());
          return true;
        } catch { /* try next */ }
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const playBellOnce = useCallback(async () => {
    const ok = await ensureAudioLoaded();
    if (!ok) return;
    const ctx = audioContextRef.current;
    const buffer = audioBufferRef.current;
    if (!ctx || !buffer) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch { /* optional */ }
  }, [ensureAudioLoaded]);

  const stopBuzzing = useCallback(() => {
    isBuzzingRef.current = false;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (bellLoopTimerRef.current) { clearTimeout(bellLoopTimerRef.current); bellLoopTimerRef.current = null; }
  }, []);

  const startBuzzing = useCallback(() => {
    if (isBuzzingRef.current || paused) return;
    isBuzzingRef.current = true;
    hapticNotification('warning');
    const loopBell = () => {
      if (!isBuzzingRef.current || paused) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        bellLoopTimerRef.current = setTimeout(loopBell, 3000);
        return;
      }
      void playBellOnce();
      const duration = audioBufferRef.current?.duration ?? 2;
      bellLoopTimerRef.current = setTimeout(loopBell, (duration * 1000) + BELL_LOOP_GAP_MS);
    };
    loopBell();
    intervalRef.current = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      hapticVibrate(500);
    }, 3000);
  }, [paused, playBellOnce]);

  const enqueueNudge = useCallback((order: NewOrder) => {
    if (dismissedRef.current.has(order.id)) return;
    const snoozedUntil = snoozedUntilRef.current[order.id];
    if (snoozedUntil && Date.now() < snoozedUntil) return;

    const bucketKey = `${order.id}-${nudgeBucket()}`;
    if (shownBucketsRef.current.has(bucketKey)) return;
    shownBucketsRef.current.add(bucketKey);

    const enriched: NewOrder = { ...order, alertKind: 'status_nudge', status: 'accepted' };
    setPendingNudges(prev => (prev.some(o => o.id === order.id) ? prev : [...prev, enriched]));
    void scheduleIncomingOrderLocalNotification({
      orderId: order.id,
      title: '⏰ Update order status',
      body: 'Order is still Accepted — tap to mark Preparing or advance.',
      amount: order.total_amount,
    });
  }, []);

  useEffect(() => {
    if (pendingNudges.length > 0 && !paused) startBuzzing();
    else stopBuzzing();
  }, [pendingNudges.length, paused, startBuzzing, stopBuzzing]);

  const dismiss = useCallback(() => {
    setPendingNudges(prev => {
      if (prev.length === 0) return prev;
      dismissedRef.current.add(prev[0].id);
      void cancelIncomingOrderLocalNotification(prev[0].id);
      const remaining = prev.slice(1);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const dismissById = useCallback((orderId: string) => {
    dismissedRef.current.add(orderId);
    delete snoozedUntilRef.current[orderId];
    void cancelIncomingOrderLocalNotification(orderId);
    setPendingNudges(prev => {
      const remaining = prev.filter(o => o.id !== orderId);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const dismissAll = useCallback(() => {
    setPendingNudges(prev => {
      prev.forEach(o => {
        dismissedRef.current.add(o.id);
        void cancelIncomingOrderLocalNotification(o.id);
      });
      stopBuzzing();
      return [];
    });
  }, [stopBuzzing]);

  const snooze = useCallback((minutes = 5) => {
    setPendingNudges(prev => {
      if (prev.length === 0) return prev;
      const current = prev[0];
      snoozedUntilRef.current[current.id] = Date.now() + Math.max(1, minutes) * 60_000;
      void cancelIncomingOrderLocalNotification(current.id);
      const remaining = prev.slice(1);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const scanStuckAccepted = useCallback(async () => {
    if (!enabled) return;
    const cutoff = new Date(Date.now() - NUDGE_INTERVAL_MS).toISOString();
    try {
      const { data } = await supabase
        .from('orders')
        .select('id, status, total_amount, created_at, seller_id, fulfillment_type, delivery_handled_by, delivery_address, delivery_lat, delivery_lng, society_id, status_changed_at')
        .in('seller_id', sellerIds)
        .eq('status', 'accepted')
        .lte('status_changed_at', cutoff)
        .limit(20);
      for (const row of data || []) {
        if (!sellerIdsRef.current.has(row.seller_id)) continue;
        enqueueNudge(row as NewOrder);
      }
    } catch {
      // Retry on next poll.
    }
  }, [enabled, sellerIds, enqueueNudge]);

  useEffect(() => {
    if (!enabled) return;
    void scanStuckAccepted();
    const timer = setInterval(() => void scanStuckAccepted(), NUDGE_INTERVAL_MS);
    const onVis = () => {
      if (document.visibilityState === 'visible') void scanStuckAccepted();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [enabled, scanStuckAccepted]);

  useEffect(() => {
    if (!enabled) return;
    const filter = `seller_id=in.(${sellerIds.join(',')})`;
    const channel = supabase
      .channel(`seller-status-nudge-${sellerIds.join('_').slice(0, 60)}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter }, (payload) => {
        const n = payload.new as any;
        if (!sellerIdsRef.current.has(n.seller_id)) return;
        if (n.status !== 'accepted') {
          dismissById(n.id);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [enabled, sellerIds.join(','), dismissById]);

  useEffect(() => {
    if (!enabled) return;
    const onPushNudge = async (event: Event) => {
      const orderId = (event as CustomEvent)?.detail?.orderId;
      if (!orderId) return;
      try {
        const { data } = await supabase
          .from('orders')
          .select('id, status, total_amount, created_at, seller_id, fulfillment_type, delivery_handled_by, delivery_address, delivery_lat, delivery_lng, society_id')
          .eq('id', orderId)
          .maybeSingle();
        if (data?.status === 'accepted') enqueueNudge(data as NewOrder);
      } catch { /* ignore */ }
    };
    window.addEventListener('seller-status-nudge', onPushNudge);
    return () => window.removeEventListener('seller-status-nudge', onPushNudge);
  }, [enabled, enqueueNudge]);

  useEffect(() => () => stopBuzzing(), [stopBuzzing]);

  return { pendingNudges, dismiss, dismissById, dismissAll, snooze };
}
