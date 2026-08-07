// @ts-nocheck
/**
 * Single shared Realtime channel for buyer order UPDATEs.
 * Prevents Home from opening 3 identical postgres_changes subscriptions.
 */
import { supabase } from '@/integrations/supabase/client';

export type BuyerOrderChangePayload = {
  new: Record<string, unknown>;
  old: Record<string, unknown> | null;
};

type Listener = (payload: BuyerOrderChangePayload) => void;
type StatusListener = (healthy: boolean) => void;

type BusEntry = {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Set<Listener>;
  statusListeners: Set<StatusListener>;
  healthy: boolean;
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
};

const buses = new Map<string, BusEntry>();

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 30000;

function notifyStatus(entry: BusEntry, healthy: boolean) {
  entry.healthy = healthy;
  for (const fn of entry.statusListeners) {
    try { fn(healthy); } catch { /* ignore */ }
  }
}

function openChannel(userId: string, entry: BusEntry) {
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }

  const channel = supabase
    .channel(`buyer-orders-bus-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `buyer_id=eq.${userId}`,
      },
      (payload) => {
        const event: BuyerOrderChangePayload = {
          new: (payload.new || {}) as Record<string, unknown>,
          old: (payload.old || null) as Record<string, unknown> | null,
        };
        for (const fn of [...entry.listeners]) {
          try { fn(event); } catch (e) {
            console.warn('[BuyerOrdersBus] listener error', e);
          }
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        entry.retryCount = 0;
        notifyStatus(entry, true);
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        notifyStatus(entry, false);
        if (entry.listeners.size === 0) return;
        if (entry.retryCount >= MAX_RETRIES) return;
        entry.retryCount += 1;
        const delay = Math.min(RETRY_BASE_MS * 2 ** (entry.retryCount - 1), RETRY_MAX_MS);
        entry.retryTimer = setTimeout(() => {
          try { supabase.removeChannel(entry.channel); } catch { /* ignore */ }
          openChannel(userId, entry);
        }, delay);
      }
    });

  entry.channel = channel;
}

function ensureBus(userId: string): BusEntry {
  let entry = buses.get(userId);
  if (entry) return entry;
  entry = {
    channel: null as any,
    listeners: new Set(),
    statusListeners: new Set(),
    healthy: false,
    retryCount: 0,
    retryTimer: null,
  };
  buses.set(userId, entry);
  openChannel(userId, entry);
  return entry;
}

function maybeTeardown(userId: string, entry: BusEntry) {
  if (entry.listeners.size > 0 || entry.statusListeners.size > 0) return;
  if (entry.retryTimer) {
    clearTimeout(entry.retryTimer);
    entry.retryTimer = null;
  }
  try { supabase.removeChannel(entry.channel); } catch { /* ignore */ }
  buses.delete(userId);
}

/** Subscribe to buyer order UPDATE events. Returns unsubscribe. */
export function subscribeBuyerOrderUpdates(userId: string, listener: Listener): () => void {
  const entry = ensureBus(userId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    maybeTeardown(userId, entry);
  };
}

/** Observe whether the shared bus channel is SUBSCRIBED. */
export function subscribeBuyerOrdersRealtimeHealth(
  userId: string,
  listener: StatusListener,
): () => void {
  const entry = ensureBus(userId);
  entry.statusListeners.add(listener);
  listener(entry.healthy);
  return () => {
    entry.statusListeners.delete(listener);
    maybeTeardown(userId, entry);
  };
}

export function isBuyerOrdersRealtimeHealthy(userId: string): boolean {
  return buses.get(userId)?.healthy ?? false;
}
