/**
 * Cross-surface acknowledge for seller order ringing.
 * View / accept / notification tap / WhatsApp should all stop the matching order bell.
 */

import { stopAllNativeOrderAlerts, stopNativeOrderAlert } from '@/plugins/order-alert-ringer';

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

/** How the seller (or system) stopped a specific order alert. */
export type OrderAlertAckSource =
  | 'APP_ACCEPT'
  | 'APP_REJECT'
  | 'NOTIFICATION_OPEN'
  | 'WHATSAPP_ACCEPT'
  | 'WHATSAPP_REJECT'
  | 'ORDER_CANCELLED'
  | 'ORDER_EXPIRED'
  | 'UNKNOWN';

export function shouldKeepIncomingOrderAlert(status: string | null | undefined): boolean {
  return !!status && (INCOMING_RING_STATUSES as readonly string[]).includes(status);
}

export function isInsertAlertStatus(status: string | null | undefined): boolean {
  return !!status && (INSERT_ALERT_STATUSES as readonly string[]).includes(status);
}

export function acknowledgeOrderAlert(
  orderId: string,
  source: OrderAlertAckSource = 'UNKNOWN',
): void {
  if (!orderId || typeof window === 'undefined') return;
  void stopNativeOrderAlert(orderId);
  window.dispatchEvent(
    new CustomEvent('order-alert-ack', { detail: { orderId, source } }),
  );
}

export function acknowledgeAllOrderAlerts(): void {
  if (typeof window === 'undefined') return;
  void stopAllNativeOrderAlerts();
  window.dispatchEvent(new CustomEvent('order-alert-ack-all'));
}
