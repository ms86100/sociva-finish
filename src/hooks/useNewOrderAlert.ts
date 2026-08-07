// @ts-nocheck
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hapticVibrate, hapticNotification } from '@/lib/haptics';
import {
  scheduleIncomingOrderLocalNotification,
  cancelIncomingOrderLocalNotification,
  cancelAllIncomingOrderLocalNotifications,
} from '@/lib/local-order-notifications';

const ACTIONABLE_STATUSES = ['placed', 'enquired', 'quoted', 'requested', 'scheduled', 'preparing'] as const;
const ACTIONABLE_STATUSES_INSERT = ['placed', 'enquired', 'quoted', 'confirmed', 'requested', 'scheduled', 'preparing'] as const;

export interface NewOrder {
  id: string;
  status: string;
  created_at: string;
  total_amount: number;
  seller_id?: string;
  fulfillment_type?: string | null;
  delivery_handled_by?: string | null;
}

const MIN_POLL_MS = 3000;
const MAX_POLL_MS = 30000;
/** When realtime is healthy, poll only as a sparse safety net (not every few seconds). */
const HEALTHY_POLL_MS = 60_000;
const BACKOFF_FACTOR = 1.5;
const DEFAULT_SNOOZE_MINUTES = 5;
const MAX_SNOOZE_CYCLES = 3; // After this many re-triggers, stop the bell loop.
const BELL_LOOP_GAP_MS = 1500;
/** Prefer order_ring (shipped with Android channel); fall back to legacy gate_bell. */
const BELL_SOUND_CANDIDATES = ['/sounds/order_ring.mp3', '/sounds/gate_bell.mp3'];

const SNOOZE_PREF_KEY = 'seller_snooze_pref_minutes';

export function getSnoozePreference(): number | null {
  try {
    const raw = sessionStorage.getItem(SNOOZE_PREF_KEY);
    if (!raw) return null;
    const v = parseInt(raw, 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function setSnoozePreference(minutes: number) {
  try { sessionStorage.setItem(SNOOZE_PREF_KEY, String(minutes)); } catch {}
}

export function clearSnoozePreference() {
  try { sessionStorage.removeItem(SNOOZE_PREF_KEY); } catch {}
}

function isActionableStatus(status: string | null | undefined): boolean {
  return !!status && ACTIONABLE_STATUSES.includes(status as typeof ACTIONABLE_STATUSES[number]);
}

export function useNewOrderAlert(sellerIds: string[]) {
  const queryClient = useQueryClient();
  const [pendingAlerts, setPendingAlerts] = useState<NewOrder[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeenAtRef = useRef<string | null>(null);
  const pollDelayRef = useRef(MIN_POLL_MS);
  const mountedAtRef = useRef(new Date().toISOString());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seenIdsOrderRef = useRef<string[]>([]);
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const snoozedUntilRef = useRef<Record<string, number>>({});
  const snoozeCyclesRef = useRef<Record<string, number>>({});
  const snoozeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingAlertsRef = useRef<NewOrder[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const bellLoopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBuzzingRef = useRef(false);

  const sellerIdsRef = useRef<Set<string>>(new Set());
  useMemo(() => { sellerIdsRef.current = new Set(sellerIds); }, [sellerIds]);

  const enabled = sellerIds.length > 0;

  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingInvalidateSellersRef = useRef<Set<string | null>>(new Set());

  const invalidateSellerOrderCaches = useCallback((sellerId?: string | null) => {
    pendingInvalidateSellersRef.current.add(sellerId ?? null);
    if (invalidateTimerRef.current) return;
    // Debounce stampede: one order UPDATE used to invalidate ~10 keys × every store
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      const keys = [
        'seller-orders',
        'seller-dashboard-stats',
        'seller-order-filter-counts',
        'seller-analytics-charts',
        'seller-analytics-summary',
        'seller-reliability',
        'seller-refund-requests',
        'seller-customers',
        'seller-settled-earnings',
      ] as const;

      const targets = [...pendingInvalidateSellersRef.current];
      pendingInvalidateSellersRef.current.clear();

      const invalidateFor = (sid?: string | null) => {
        for (const key of keys) {
          if (sid) queryClient.invalidateQueries({ queryKey: [key, sid] });
          else queryClient.invalidateQueries({ queryKey: [key] });
        }
      };

      const hasNull = targets.includes(null);
      const explicit = targets.filter((t): t is string => typeof t === 'string');
      if (hasNull && explicit.length === 0) {
        for (const sid of sellerIdsRef.current) invalidateFor(sid);
        invalidateFor(null);
        return;
      }
      for (const sid of explicit) invalidateFor(sid);
      if (hasNull) invalidateFor(null);
    }, 400);
  }, [queryClient]);

  const ensureAudioLoaded = useCallback(async () => {
    if (audioBufferRef.current) return true;
    try {
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      let lastErr: unknown = null;
      for (const url of BELL_SOUND_CANDIDATES) {
        try {
          const response = await fetch(url);
          if (!response.ok) continue;
          const arrayBuffer = await response.arrayBuffer();
          audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
          return true;
        } catch (e) {
          lastErr = e;
        }
      }
      console.warn('[OrderAlert] Web Audio load failed:', lastErr);
      return false;
    } catch (e) {
      console.warn('[OrderAlert] Web Audio load failed:', e);
      return false;
    }
  }, []);

  const MAX_SEEN_IDS = 500;
  const handleNewOrder = useCallback((order: NewOrder) => {
    if (seenIdsRef.current.has(order.id)) return;
    if (dismissedIdsRef.current.has(order.id)) return;
    if (!isActionableStatus(order.status)) return;
    const snoozedUntil = snoozedUntilRef.current[order.id];
    if (snoozedUntil && Date.now() < snoozedUntil) return;
    seenIdsRef.current.add(order.id);
    seenIdsOrderRef.current.push(order.id);
    while (seenIdsRef.current.size > MAX_SEEN_IDS) {
      const oldest = seenIdsOrderRef.current.shift();
      if (oldest) seenIdsRef.current.delete(oldest);
    }
    if (!lastSeenAtRef.current || order.created_at > lastSeenAtRef.current) {
      lastSeenAtRef.current = order.created_at;
    }
    pollDelayRef.current = MIN_POLL_MS;
    setPendingAlerts(prev => [...prev, order]);
    invalidateSellerOrderCaches(order.seller_id);
    void scheduleIncomingOrderLocalNotification({
      orderId: order.id,
      title: 'New order',
      amount: order.total_amount,
    });
  }, [invalidateSellerOrderCaches]);

  const playBellOnce = useCallback(async () => {
    const isLoaded = await ensureAudioLoaded();
    if (!isLoaded) return;
    const ctx = audioContextRef.current;
    const buffer = audioBufferRef.current;
    if (!ctx || !buffer) return;
    try {
      if (ctx.state === 'suspended') ctx.resume();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch (e) {
      console.warn('[OrderAlert] Web Audio play failed:', e);
    }
  }, [ensureAudioLoaded]);

  const stopBuzzing = useCallback(() => {
    isBuzzingRef.current = false;
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (bellLoopTimerRef.current) { clearTimeout(bellLoopTimerRef.current); bellLoopTimerRef.current = null; }
  }, []);

  const startBuzzing = useCallback(() => {
    if (isBuzzingRef.current) return;
    isBuzzingRef.current = true;
    hapticNotification('warning');
    const loopBell = () => {
      if (!isBuzzingRef.current) return;
      // Audio / haptics while backgrounded drains battery and is blocked on many OEMs.
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
  }, [playBellOnce]);

  const dismiss = useCallback(() => {
    setPendingAlerts(prev => {
      if (prev.length === 0) return prev;
      dismissedIdsRef.current.add(prev[0].id);
      void cancelIncomingOrderLocalNotification(prev[0].id);
      const remaining = prev.slice(1);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const dismissById = useCallback((orderId: string) => {
    if (snoozeTimersRef.current[orderId]) {
      clearTimeout(snoozeTimersRef.current[orderId]);
      delete snoozeTimersRef.current[orderId];
    }
    delete snoozedUntilRef.current[orderId];
    void cancelIncomingOrderLocalNotification(orderId);
    setPendingAlerts(prev => {
      const idx = prev.findIndex(o => o.id === orderId);
      if (idx === -1) {
        // Still mark dismissed so snooze / poll cannot resurrect a terminal order
        dismissedIdsRef.current.add(orderId);
        return prev;
      }
      dismissedIdsRef.current.add(orderId);
      const remaining = prev.filter(o => o.id !== orderId);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const dismissAll = useCallback(() => {
    setPendingAlerts(prev => {
      prev.forEach(o => {
        dismissedIdsRef.current.add(o.id);
        if (snoozeTimersRef.current[o.id]) {
          clearTimeout(snoozeTimersRef.current[o.id]);
          delete snoozeTimersRef.current[o.id];
        }
        delete snoozedUntilRef.current[o.id];
      });
      void cancelAllIncomingOrderLocalNotifications();
      stopBuzzing();
      return [];
    });
  }, [stopBuzzing]);

  const handleTerminalOrder = useCallback((orderId: string, sellerId?: string | null) => {
    dismissById(orderId);
    seenIdsRef.current.delete(orderId);
    invalidateSellerOrderCaches(sellerId);
    queryClient.invalidateQueries({ queryKey: ['unread-notifications'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
    queryClient.invalidateQueries({ queryKey: ['latest-action-notification'] });
  }, [dismissById, invalidateSellerOrderCaches, queryClient]);

  /**
   * Snooze the current top alert.
   * @param snoozeMinutes Optional explicit interval. If omitted, falls back to
   *   the persisted seller pref or DEFAULT_SNOOZE_MINUTES.
   *
   * After MAX_SNOOZE_CYCLES re-triggers for the same order, the order is
   * marked dismissed so we don't keep re-ringing the bell forever.
   */
  const snooze = useCallback((snoozeMinutes?: number) => {
    setPendingAlerts(prev => {
      if (prev.length === 0) return prev;
      const current = prev[0];
      const minutes = snoozeMinutes ?? getSnoozePreference() ?? DEFAULT_SNOOZE_MINUTES;
      const ms = Math.max(1, minutes) * 60 * 1000;

      const cycles = (snoozeCyclesRef.current[current.id] || 0) + 1;
      snoozeCyclesRef.current[current.id] = cycles;

      // Cap re-triggers
      if (cycles > MAX_SNOOZE_CYCLES) {
        dismissedIdsRef.current.add(current.id);
        const remaining = prev.slice(1);
        if (remaining.length === 0) stopBuzzing();
        return remaining;
      }

      seenIdsRef.current.delete(current.id);
      snoozedUntilRef.current[current.id] = Date.now() + ms;
      if (snoozeTimersRef.current[current.id]) {
        clearTimeout(snoozeTimersRef.current[current.id]);
      }
      snoozeTimersRef.current[current.id] = setTimeout(async () => {
        delete snoozeTimersRef.current[current.id];
        if (dismissedIdsRef.current.has(current.id)) return;
        delete snoozedUntilRef.current[current.id];
        try {
          const { data } = await supabase
            .from('orders')
            .select('id, status, created_at, total_amount, seller_id, fulfillment_type, delivery_handled_by')
            .eq('id', current.id)
            .maybeSingle();
          if (!data || !isActionableStatus(data.status)) {
            dismissedIdsRef.current.add(current.id);
            invalidateSellerOrderCaches(data?.seller_id ?? current.seller_id);
            return;
          }
          setPendingAlerts(curr => (curr.some(o => o.id === current.id) ? curr : [...curr, data as NewOrder]));
          seenIdsRef.current.add(current.id);
        } catch {
          // Network failure: do not resurrect without status proof
          dismissedIdsRef.current.add(current.id);
        }
      }, ms);
      const remaining = prev.slice(1);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing, invalidateSellerOrderCaches]);

  // ── Realtime subscription (filtered to this seller's stores only) ──
  const realtimeHealthyRef = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const filter = `seller_id=in.(${sellerIds.join(',')})`;
    const channelKey = sellerIds.slice().sort().join('_').slice(0, 80);
    const channel = supabase
      .channel(`seller-new-orders-${channelKey}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter }, (payload) => {
        const n = payload.new as any;
        if (!sellerIdsRef.current.has(n.seller_id)) return;
        if (!ACTIONABLE_STATUSES_INSERT.includes(n.status)) return;
        handleNewOrder({
          id: n.id, status: n.status, created_at: n.created_at,
          total_amount: n.total_amount, seller_id: n.seller_id,
          fulfillment_type: n.fulfillment_type, delivery_handled_by: n.delivery_handled_by,
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter }, (payload) => {
        const n = payload.new as any;
        if (!sellerIdsRef.current.has(n.seller_id)) return;
        // Always refresh board/stats/analytics on any status change — even when
        // handleNewOrder early-returns (seenIds) for placed→preparing etc.
        invalidateSellerOrderCaches(n.seller_id);
        if (isActionableStatus(n.status)) {
          handleNewOrder({
            id: n.id, status: n.status, created_at: n.created_at,
            total_amount: n.total_amount, seller_id: n.seller_id,
            fulfillment_type: n.fulfillment_type, delivery_handled_by: n.delivery_handled_by,
          });
        } else {
          // Cancelled / expired / accepted / rejected / completed / etc. — stop overlay
          handleTerminalOrder(n.id, n.seller_id);
        }
      })
      .subscribe((status) => {
        realtimeHealthyRef.current = status === 'SUBSCRIBED';
        if (status === 'SUBSCRIBED') {
          pollDelayRef.current = HEALTHY_POLL_MS;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          realtimeHealthyRef.current = false;
          pollDelayRef.current = MIN_POLL_MS;
        }
      });
    return () => {
      realtimeHealthyRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [enabled, sellerIds.join(','), handleNewOrder, handleTerminalOrder, invalidateSellerOrderCaches]);

  // Push-driven terminal sync (when realtime misses but FCM carries is_terminal)
  useEffect(() => {
    if (!enabled) return;
    const onTerminalPush = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const orderId = detail?.orderId;
      if (!orderId) return;
      handleTerminalOrder(orderId, detail?.sellerId ?? null);
    };
    window.addEventListener('order-terminal-push', onTerminalPush);
    return () => window.removeEventListener('order-terminal-push', onTerminalPush);
  }, [enabled, handleTerminalOrder]);

  // Reconcile pending overlays against live DB (resume / tab focus)
  useEffect(() => {
    if (!enabled) return;

    const reconcile = async () => {
      const curr = pendingAlertsRef.current;
      if (curr.length === 0) return;
      const ids = curr.map(o => o.id);
      try {
        const { data } = await supabase
          .from('orders')
          .select('id, status, seller_id')
          .in('id', ids);
        if (!data) return;
        const byId = new Map(data.map((o: any) => [o.id, o]));
        for (const alert of curr) {
          const live = byId.get(alert.id);
          if (!live || !isActionableStatus(live.status)) {
            handleTerminalOrder(alert.id, live?.seller_id ?? alert.seller_id);
          }
        }
      } catch {}
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') void reconcile();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [enabled, handleTerminalOrder]);

  // ── Polling fallback ──
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pausedByVisibility = false;

    const poll = async () => {
      if (cancelled || pausedByVisibility) return;
      try {
        let query = supabase
          .from('orders')
          .select('id, status, total_amount, created_at, seller_id, fulfillment_type, delivery_handled_by')
          .in('seller_id', sellerIds)
          .in('status', [...ACTIONABLE_STATUSES])
          .order('created_at', { ascending: true });

        if (lastSeenAtRef.current) query = query.gt('created_at', lastSeenAtRef.current);
        else query = query.gt('created_at', mountedAtRef.current);

        const { data } = await query;
        if (data && data.length > 0) {
          data.forEach(order => handleNewOrder(order as NewOrder));
          pollDelayRef.current = realtimeHealthyRef.current ? HEALTHY_POLL_MS : MIN_POLL_MS;
        } else {
          const ceiling = realtimeHealthyRef.current ? HEALTHY_POLL_MS : MAX_POLL_MS;
          const floor = realtimeHealthyRef.current ? HEALTHY_POLL_MS : MIN_POLL_MS;
          pollDelayRef.current = Math.min(
            Math.max(pollDelayRef.current * BACKOFF_FACTOR, floor),
            ceiling,
          );
        }
      } catch {}

      if (!cancelled) pollTimerRef.current = setTimeout(poll, pollDelayRef.current);
    };

    pollTimerRef.current = setTimeout(poll, 0);

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        pausedByVisibility = true;
        if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      } else {
        pausedByVisibility = false;
        pollDelayRef.current = MIN_POLL_MS;
        if (!pollTimerRef.current) pollTimerRef.current = setTimeout(poll, 0);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, sellerIds.join(','), handleNewOrder]);

  useEffect(() => {
    pendingAlertsRef.current = pendingAlerts;
    if (pendingAlerts.length > 0) startBuzzing();
    else stopBuzzing();
    return () => stopBuzzing();
  }, [pendingAlerts, startBuzzing, stopBuzzing]);

  useEffect(() => () => {
    stopBuzzing();
    Object.values(snoozeTimersRef.current).forEach(clearTimeout);
    snoozeTimersRef.current = {};
    if (invalidateTimerRef.current) {
      clearTimeout(invalidateTimerRef.current);
      invalidateTimerRef.current = null;
    }
  }, [stopBuzzing]);

  return { pendingAlerts, dismiss, dismissById, dismissAll, snooze };
}
