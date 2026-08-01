// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';

interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Send a push notification with retry + exponential backoff (max 3 attempts).
 */
export async function sendPushNotification(payload: NotificationPayload): Promise<boolean> {
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

      console.log('Push notification sent:', data);
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
