/**
 * Capacitor LocalNotifications for reliable foreground / app-open order ringing.
 * Uses channel orders_incoming_v1 + sound order_ring. Cancel on terminal.
 */
import { Capacitor } from '@capacitor/core';
import { ORDERS_INCOMING_CHANNEL_ID } from '@/lib/notification-channel-settings';

const CHANNEL_CREATED_KEY = 'sociva_ln_channel_v1';

/** Stable positive 31-bit int from order UUID (LocalNotifications requires numeric id). */
export function orderNotificationId(orderId: string): number {
  let hash = 0;
  for (let i = 0; i < orderId.length; i++) {
    hash = ((hash << 5) - hash) + orderId.charCodeAt(i);
    hash |= 0;
  }
  const id = Math.abs(hash) % 2_000_000_000;
  return id === 0 ? 1 : id;
}

async function ensureLocalChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return;
  try {
    if (sessionStorage.getItem(CHANNEL_CREATED_KEY) === '1') return;
  } catch { /* ignore */ }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel({
      id: ORDERS_INCOMING_CHANNEL_ID,
      name: 'Incoming Orders',
      description: 'High-priority ringing alerts for new seller orders',
      importance: 5,
      visibility: 1,
      sound: 'order_ring',
      vibration: true,
      lights: true,
    });
    try { sessionStorage.setItem(CHANNEL_CREATED_KEY, '1'); } catch { /* ignore */ }
  } catch (e) {
    console.warn('[LocalNotif] channel create failed:', e);
  }
}

export async function ensureLocalNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    let perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      perm = await LocalNotifications.requestPermissions();
    }
    return perm.display === 'granted';
  } catch {
    return false;
  }
}

/**
 * Schedule (or refresh) a high-priority local notification for an incoming order.
 * Safe to call repeatedly for the same orderId (replaces by id).
 */
export async function scheduleIncomingOrderLocalNotification(opts: {
  orderId: string;
  title?: string;
  body?: string;
  amount?: number;
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const ok = await ensureLocalNotificationPermission();
    if (!ok) return;
    await ensureLocalChannel();

    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const id = orderNotificationId(opts.orderId);
    const title = opts.title || 'New order';
    const body = opts.body
      || (opts.amount != null ? `₹${Number(opts.amount).toFixed(0)} — tap to review` : 'Tap to review and accept');

    await LocalNotifications.schedule({
      notifications: [{
        id,
        title,
        body,
        channelId: ORDERS_INCOMING_CHANNEL_ID,
        sound: 'order_ring',
        extra: { orderId: opts.orderId, type: 'order', high_priority: 'true' },
        schedule: { at: new Date(Date.now() + 250) },
        actionTypeId: 'OPEN_ORDER',
      }],
    });
  } catch (e) {
    console.warn('[LocalNotif] schedule failed:', e);
  }
}

/** Cancel local notification when order becomes terminal / dismissed. */
export async function cancelIncomingOrderLocalNotification(orderId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const id = orderNotificationId(orderId);
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch (e) {
    console.warn('[LocalNotif] cancel failed:', e);
  }
}

export async function cancelAllIncomingOrderLocalNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const pending = await LocalNotifications.getPending();
    const ids = (pending.notifications || [])
      .filter((n) => (n.extra as { type?: string } | undefined)?.type === 'order')
      .map((n) => ({ id: n.id }));
    if (ids.length > 0) {
      await LocalNotifications.cancel({ notifications: ids });
    }
  } catch (e) {
    console.warn('[LocalNotif] cancelAll failed:', e);
  }
}
