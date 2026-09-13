/**
 * Cross-surface acknowledge for seller order ringing.
 * View / accept / notification tap should all stop the in-app bell.
 */

/** Statuses that keep the full-screen incoming alert + looped bell. */
export const INCOMING_RING_STATUSES = [
  'placed',
  'enquired',
  'quoted',
  'requested',
] as const;

/** Statuses that may fire a one-shot alert on INSERT (e.g. auto-accept / booking). */
export const INSERT_ALERT_STATUSES = [
  ...INCOMING_RING_STATUSES,
  'scheduled',
  'preparing',
  'confirmed',
] as const;

export function shouldKeepIncomingOrderAlert(status: string | null | undefined): boolean {
  return !!status && (INCOMING_RING_STATUSES as readonly string[]).includes(status);
}

export function isInsertAlertStatus(status: string | null | undefined): boolean {
  return !!status && (INSERT_ALERT_STATUSES as readonly string[]).includes(status);
}

export function acknowledgeOrderAlert(orderId: string): void {
  if (!orderId || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('order-alert-ack', { detail: { orderId } }));
}

export function acknowledgeAllOrderAlerts(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('order-alert-ack-all'));
}
