/**
 * Channel-abstracted notification client for Sociva.
 * WhatsApp via send-whatsapp Edge Function (admin) or via notification_queue → process-notification-queue.
 * Later: email / SMS without changing booking call sites.
 */
import { supabase } from '@/integrations/supabase/client';

export type NotificationChannel = 'whatsapp' | 'email' | 'push' | 'sms';

export type NotificationTemplate =
  | 'raw'
  | 'otp'
  | 'booking_confirmation'
  | 'booking_cancelled'
  | 'booking_reminder'
  | 'order_update'
  | 'new_order_seller'
  | 'payment_update'
  | 'refund_update';

export type NotificationRequest = {
  channel: NotificationChannel;
  template: NotificationTemplate;
  recipient: string;
  message?: string;
  data?: Record<string, string>;
};

export type NotificationResult = {
  success: boolean;
  code?: string;
  error?: string;
  meta?: unknown;
  metaMessageId?: string;
  elapsedMs?: number;
};

async function sendWhatsApp(req: NotificationRequest): Promise<NotificationResult> {
  const { data, error } = await supabase.functions.invoke('send-whatsapp', {
    body: {
      phoneNumber: req.recipient,
      message: req.message,
      template: req.template,
      data: req.data,
    },
  });

  if (error) {
    return { success: false, code: 'unexpected', error: error.message, meta: data };
  }
  return {
    success: !!data?.success,
    code: data?.code,
    error: data?.error,
    meta: data?.meta,
    metaMessageId: data?.metaMessageId,
    elapsedMs: data?.elapsedMs,
  };
}

export const notificationService = {
  async send(req: NotificationRequest): Promise<NotificationResult> {
    switch (req.channel) {
      case 'whatsapp':
        return sendWhatsApp(req);
      case 'email':
      case 'push':
      case 'sms':
        return {
          success: false,
          code: 'meta_error',
          error: `Channel ${req.channel} is not wired yet — use whatsapp or notification_queue`,
        };
      default:
        return { success: false, code: 'unexpected', error: 'Unknown channel' };
    }
  },
};
