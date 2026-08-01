// @ts-nocheck
/**
 * Tiny module-level registry used to silence the seller chat bell while
 * the seller is actively viewing/replying to a specific order's chat.
 *
 * - setActiveChat(orderId): mark a chat as currently focused (also refreshes
 *   a 60s liveness timestamp used as a soft fallback).
 * - clearActiveChat(orderId): remove on close/unmount.
 * - isChatActive(orderId): true if focused OR last activity within 60s.
 * - silenceChatBell(orderId): emits an event consumed by useSellerChatAlerts
 *   to immediately squelch any pending bell for that order.
 */
type Listener = (orderId: string) => void;

const activeMap = new Map<string, number>(); // orderId -> last-active timestamp (ms)
const listeners = new Set<Listener>();
const ACTIVE_WINDOW_MS = 60_000;

export function setActiveChat(orderId: string) {
  if (!orderId) return;
  activeMap.set(orderId, Date.now());
}

export function clearActiveChat(orderId: string) {
  if (!orderId) return;
  activeMap.delete(orderId);
}

export function isChatActive(orderId: string): boolean {
  if (!orderId) return false;
  const ts = activeMap.get(orderId);
  if (!ts) return false;
  if (Date.now() - ts > ACTIVE_WINDOW_MS) {
    activeMap.delete(orderId);
    return false;
  }
  return true;
}

export function silenceChatBell(orderId: string) {
  if (!orderId) return;
  // Refresh active timestamp so subsequent inserts are also silenced briefly.
  activeMap.set(orderId, Date.now());
  listeners.forEach((l) => {
    try { l(orderId); } catch { /* noop */ }
  });
}

export function onSilenceChatBell(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
