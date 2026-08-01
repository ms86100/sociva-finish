import { type Page } from '@playwright/test';
import { type SupabaseClient } from '@supabase/supabase-js';

/**
 * Notification validation utilities.
 * Three layers: DB, API interception, processing status.
 */

/**
 * Poll notification_queue for an entry matching the order ID.
 */
export async function pollNotificationQueue(
  db: SupabaseClient,
  orderId: string,
  timeoutMs = 10_000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await db
      .from('notification_queue')
      .select('*')
      .contains('payload', { order_id: orderId })
      .limit(1)
      .maybeSingle();
    if (data) return data;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No notification found for order ${orderId} within ${timeoutMs}ms`);
}

/**
 * Set up route interception for FCM and APNs push endpoints.
 * Returns a promise that resolves with the captured request payload.
 */
export async function interceptPushDelivery(page: Page): Promise<{
  waitForFCM: () => Promise<any>;
  waitForAPNs: () => Promise<any>;
}> {
  const fcmRequests: any[] = [];
  const apnsRequests: any[] = [];

  // Intercept FCM
  await page.route('**/fcm.googleapis.com/**', async (route) => {
    try {
      const body = route.request().postDataJSON();
      fcmRequests.push(body);
    } catch {}
    await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
  });

  // Intercept APNs
  await page.route('**/api.push.apple.com/**', async (route) => {
    try {
      const body = route.request().postDataJSON();
      apnsRequests.push(body);
    } catch {}
    await route.fulfill({ status: 200 });
  });

  return {
    waitForFCM: async () => {
      const start = Date.now();
      while (Date.now() - start < 15_000) {
        if (fcmRequests.length > 0) return fcmRequests[0];
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    },
    waitForAPNs: async () => {
      const start = Date.now();
      while (Date.now() - start < 15_000) {
        if (apnsRequests.length > 0) return apnsRequests[0];
        await new Promise((r) => setTimeout(r, 500));
      }
      return null;
    },
  };
}

/**
 * Validate notification payload structure.
 */
export function validateNotificationPayload(
  notification: any,
  expected: { orderId: string; type?: string }
) {
  const payload = typeof notification.payload === 'string'
    ? JSON.parse(notification.payload)
    : notification.payload;

  if (payload.order_id !== expected.orderId) {
    throw new Error(
      `Notification payload order_id mismatch: got ${payload.order_id}, expected ${expected.orderId}`
    );
  }

  if (expected.type && payload.type !== expected.type) {
    throw new Error(
      `Notification type mismatch: got ${payload.type}, expected ${expected.type}`
    );
  }

  return payload;
}

/**
 * Assert notification was processed (status = 'sent').
 */
export async function assertNotificationProcessed(
  db: SupabaseClient,
  notificationId: string,
  timeoutMs = 15_000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await db
      .from('notification_queue')
      .select('status, attempts')
      .eq('id', notificationId)
      .single();
    if (data?.status === 'sent') return data;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Notification ${notificationId} not processed within ${timeoutMs}ms`);
}
