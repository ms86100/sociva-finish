import { Capacitor, registerPlugin } from '@capacitor/core';

export interface OrderAlertRingerPlugin {
  start(opts: { orderId: string }): Promise<{ ok: boolean; active: number }>;
  stop(opts: { orderId: string }): Promise<{ ok: boolean; active: number }>;
  stopAll(): Promise<{ ok: boolean; active: number }>;
  activeCount(): Promise<{ count: number }>;
}

const native = registerPlugin<OrderAlertRingerPlugin>('OrderAlertRinger');

const webNoop: OrderAlertRingerPlugin = {
  start: async () => ({ ok: false, active: 0 }),
  stop: async () => ({ ok: false, active: 0 }),
  stopAll: async () => ({ ok: false, active: 0 }),
  activeCount: async () => ({ count: 0 }),
};

export const OrderAlertRinger =
  Capacitor.getPlatform() === 'android' ? native : webNoop;

export function isNativeOrderAlertRingerAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** Start native notification-ringtone looping for one order (Android only). */
export async function startNativeOrderAlert(orderId: string): Promise<boolean> {
  if (!isNativeOrderAlertRingerAvailable() || !orderId) return false;
  try {
    const res = await OrderAlertRinger.start({ orderId });
    return !!res?.ok;
  } catch {
    return false;
  }
}

/** Stop native ringing for one order without affecting other active orders. */
export async function stopNativeOrderAlert(orderId: string): Promise<void> {
  if (!isNativeOrderAlertRingerAvailable() || !orderId) return;
  try {
    await OrderAlertRinger.stop({ orderId });
  } catch {
    /* best-effort */
  }
}

export async function stopAllNativeOrderAlerts(): Promise<void> {
  if (!isNativeOrderAlertRingerAvailable()) return;
  try {
    await OrderAlertRinger.stopAll();
  } catch {
    /* best-effort */
  }
}
