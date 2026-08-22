/**
 * Shared Realtime channel for seller credit account/ledger changes.
 * Dashboard and SellerJourneyBanner both subscribe; a second .on() on the
 * same topic after subscribe() throws in supabase-js.
 */
import { supabase } from '@/integrations/supabase/client';

type CreditChangeListener = () => void;

type CreditBusEntry = {
  channel: ReturnType<typeof supabase.channel> | null;
  listeners: Set<CreditChangeListener>;
  sellerIds: string[];
};

const buses = new Map<string, CreditBusEntry>();

export function sellerCreditRealtimeChannelName(sellerIds: string[]): string {
  return `seller-credits-${scopeKey(sellerIds)}`;
}

export function scopeKey(sellerIds: string[]): string {
  return [...new Set(sellerIds.filter(Boolean))].sort().join(',');
}

function topicMatches(channel: { topic?: string }, name: string): boolean {
  const topic = channel.topic || '';
  return topic === name || topic === `realtime:${name}` || topic.endsWith(`:${name}`);
}

function removeLeftoverChannel(name: string) {
  const channels = typeof supabase.getChannels === 'function' ? supabase.getChannels() : [];
  for (const existing of channels) {
    if (!topicMatches(existing as { topic?: string }, name)) continue;
    try {
      supabase.removeChannel(existing);
    } catch {
      /* ignore */
    }
  }
}

function sellerIdFromPayload(payload: {
  new?: { seller_id?: string } | null;
  old?: { seller_id?: string } | null;
}): string | null {
  return payload.new?.seller_id || payload.old?.seller_id || null;
}

function dispatch(entry: CreditBusEntry, payload: {
  new?: { seller_id?: string } | null;
  old?: { seller_id?: string } | null;
}) {
  const id = sellerIdFromPayload(payload);
  if (id && !entry.sellerIds.includes(id)) return;
  for (const listener of [...entry.listeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[SellerCreditsBus] listener error', error);
    }
  }
}

function openChannel(key: string, entry: CreditBusEntry) {
  const name = `seller-credits-${key}`;
  removeLeftoverChannel(name);

  const channel = supabase
    .channel(name)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'seller_credit_accounts' },
      (payload) => dispatch(entry, payload),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'seller_credit_ledger' },
      (payload) => dispatch(entry, payload),
    )
    .subscribe();

  entry.channel = channel;
}

function ensureBus(sellerIds: string[]): CreditBusEntry {
  const key = scopeKey(sellerIds);
  let entry = buses.get(key);
  if (entry) return entry;
  entry = {
    channel: null,
    listeners: new Set(),
    sellerIds: key.split(',').filter(Boolean),
  };
  buses.set(key, entry);
  openChannel(key, entry);
  return entry;
}

function maybeTeardown(key: string, entry: CreditBusEntry) {
  if (entry.listeners.size > 0) return;
  if (entry.channel) {
    try {
      supabase.removeChannel(entry.channel);
    } catch {
      /* ignore */
    }
  }
  buses.delete(key);
}

/** Subscribe to credit table changes for these seller ids. Returns unsubscribe. */
export function subscribeSellerCreditRealtime(
  sellerIds: string[],
  listener: CreditChangeListener,
): () => void {
  const key = scopeKey(sellerIds);
  if (!key) return () => {};
  const entry = ensureBus(sellerIds);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    maybeTeardown(key, entry);
  };
}

/** Test helper: drop in-memory buses without touching supabase. */
export function resetSellerCreditRealtimeBusForTests() {
  buses.clear();
}

export function sellerCreditRealtimeSubscriberCount(sellerIds: string[]): number {
  return buses.get(scopeKey(sellerIds))?.listeners.size ?? 0;
}
