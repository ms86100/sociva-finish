// @ts-nocheck
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hapticVibrate, hapticNotification } from '@/lib/haptics';

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
const BACKOFF_FACTOR = 1.5;
const DEFAULT_SNOOZE_MINUTES = 5;
const MAX_SNOOZE_CYCLES = 3; // After this many re-triggers, stop the bell loop.
const BELL_LOOP_GAP_MS = 1500;

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

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const bellLoopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBuzzingRef = useRef(false);

  const sellerIdsRef = useRef<Set<string>>(new Set());
  useMemo(() => { sellerIdsRef.current = new Set(sellerIds); }, [sellerIds]);

  const enabled = sellerIds.length > 0;

  const ensureAudioLoaded = useCallback(async () => {
    if (audioBufferRef.current) return true;
    try {
      const ctx = audioContextRef.current || new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = ctx;
      const response = await fetch('/sounds/gate_bell.mp3');
      const arrayBuffer = await response.arrayBuffer();
      audioBufferRef.current = await ctx.decodeAudioData(arrayBuffer);
      return true;
    } catch (e) {
      console.warn('[OrderAlert] Web Audio load failed:', e);
      return false;
    }
  }, []);

  const MAX_SEEN_IDS = 500;
  const handleNewOrder = useCallback((order: NewOrder) => {
    if (seenIdsRef.current.has(order.id)) return;
    if (dismissedIdsRef.current.has(order.id)) return;
    if (!ACTIONABLE_STATUSES.includes(order.status as typeof ACTIONABLE_STATUSES[number])) return;
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
    if (order.seller_id) {
      queryClient.invalidateQueries({ queryKey: ['seller-orders', order.seller_id] });
      queryClient.invalidateQueries({ queryKey: ['seller-dashboard-stats', order.seller_id] });
    } else {
      for (const sid of sellerIdsRef.current) {
        queryClient.invalidateQueries({ queryKey: ['seller-orders', sid] });
        queryClient.invalidateQueries({ queryKey: ['seller-dashboard-stats', sid] });
      }
    }
  }, [queryClient]);

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
      void playBellOnce();
      const duration = audioBufferRef.current?.duration ?? 2;
      bellLoopTimerRef.current = setTimeout(loopBell, (duration * 1000) + BELL_LOOP_GAP_MS);
    };
    loopBell();
    intervalRef.current = setInterval(() => { hapticVibrate(500); }, 3000);
  }, [playBellOnce]);

  const dismiss = useCallback(() => {
    setPendingAlerts(prev => {
      if (prev.length === 0) return prev;
      dismissedIdsRef.current.add(prev[0].id);
      const remaining = prev.slice(1);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const dismissById = useCallback((orderId: string) => {
    setPendingAlerts(prev => {
      const idx = prev.findIndex(o => o.id === orderId);
      if (idx === -1) return prev;
      dismissedIdsRef.current.add(orderId);
      const remaining = prev.filter(o => o.id !== orderId);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  const dismissAll = useCallback(() => {
    setPendingAlerts(prev => {
      prev.forEach(o => dismissedIdsRef.current.add(o.id));
      stopBuzzing();
      return [];
    });
  }, [stopBuzzing]);

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
      setTimeout(() => {
        if (dismissedIdsRef.current.has(current.id)) return;
        delete snoozedUntilRef.current[current.id];
        setPendingAlerts(curr => (curr.some(o => o.id === current.id) ? curr : [...curr, current]));
        seenIdsRef.current.add(current.id);
      }, ms);
      const remaining = prev.slice(1);
      if (remaining.length === 0) stopBuzzing();
      return remaining;
    });
  }, [stopBuzzing]);

  // ── Realtime subscription ──
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('seller-new-orders-multi')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
        const n = payload.new as any;
        if (!sellerIdsRef.current.has(n.seller_id)) return;
        if (!ACTIONABLE_STATUSES_INSERT.includes(n.status)) return;
        handleNewOrder({
          id: n.id, status: n.status, created_at: n.created_at,
          total_amount: n.total_amount, seller_id: n.seller_id,
          fulfillment_type: n.fulfillment_type, delivery_handled_by: n.delivery_handled_by,
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
        const n = payload.new as any;
        if (!sellerIdsRef.current.has(n.seller_id)) return;
        if (ACTIONABLE_STATUSES.includes(n.status)) {
          handleNewOrder({
            id: n.id, status: n.status, created_at: n.created_at,
            total_amount: n.total_amount, seller_id: n.seller_id,
            fulfillment_type: n.fulfillment_type, delivery_handled_by: n.delivery_handled_by,
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [enabled, handleNewOrder]);

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
          pollDelayRef.current = MIN_POLL_MS;
        } else {
          pollDelayRef.current = Math.min(pollDelayRef.current * BACKOFF_FACTOR, MAX_POLL_MS);
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
    if (pendingAlerts.length > 0) startBuzzing();
    else stopBuzzing();
    return () => stopBuzzing();
  }, [pendingAlerts.length, startBuzzing, stopBuzzing]);

  useEffect(() => () => stopBuzzing(), [stopBuzzing]);

  return { pendingAlerts, dismiss, dismissById, dismissAll, snooze };
}
