// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';
import { createQueuedNotification } from '@/lib/notification-lifecycle';
import { dualNotificationColumns } from '@/lib/notification-fields';

interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Enqueue a notification through notification_queue → PNQ.
 * Prefer this over direct send-push-notification so metadata (order_id,
 * is_terminal, channel/sound) stays consistent.
 */
export async function sendPushNotification(payload: NotificationPayload): Promise<boolean> {
  const type = payload.data?.type || 'general';
  const path = payload.data?.path || payload.data?.reference_path || payload.data?.action_url || null;
  const result = await createQueuedNotification({
    userId: payload.userId,
    title: payload.title,
    body: payload.body,
    type,
    path,
    data: {
      ...(payload.data || {}),
      ...dualNotificationColumns({ path, data: payload.data || {} }).data,
    },
  });
  return result.ok;
}

/**
 * Legacy direct edge invoke — kept for emergency/admin tooling.
 * Prefer sendPushNotification (queue path).
 */
export async function sendPushNotificationDirect(payload: NotificationPayload): Promise<boolean> {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await supabase.functions.invoke('send-push-notification', {
        body: payload,
      });

      if (error) {
        console.error(`[Push] Attempt ${attempt}/${MAX_ATTEMPTS} failed:`, error);
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, attempt * 1000));
          continue;
        }
        return false;
      }

      console.log('Push notification sent (direct):', data);
      return data?.sent > 0;
    } catch (err) {
      console.error(`[Push] Attempt ${attempt}/${MAX_ATTEMPTS} exception:`, err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, attempt * 1000));
        continue;
      }
      return false;
    }
  }
  return false;
}
