/**
 * Channel-abstracted notification client for Sociva.
 * WhatsApp via send-whatsapp; push via notification_queue → PNQ.
 */
import { supabase } from '@/integrations/supabase/client';
import { createQueuedNotification } from '@/lib/notification-lifecycle';

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
  /** Required for push channel (user uuid). For WhatsApp this is the phone number. */
  message?: string;
  title?: string;
  data?: Record<string, string>;
  userId?: string;
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

async function sendPush(req: NotificationRequest): Promise<NotificationResult> {
  const userId = req.userId || req.recipient;
  if (!userId) {
    return { success: false, code: 'unexpected', error: 'userId required for push' };
  }
  const title = req.title || 'Sociva';
  const body = req.message || '';
  const type = req.data?.type || req.template || 'general';
  const result = await createQueuedNotification({
    userId,
    title,
    body,
    type,
    path: req.data?.path || req.data?.action_url || null,
    data: { ...(req.data || {}), template: req.template },
  });
  return result.ok
    ? { success: true, code: 'queued' }
    : { success: false, code: 'unexpected', error: result.error };
}

export const notificationService = {
  async send(req: NotificationRequest): Promise<NotificationResult> {
    switch (req.channel) {
      case 'whatsapp':
        return sendWhatsApp(req);
      case 'push':
        return sendPush(req);
      case 'email':
      case 'sms':
        return {
          success: false,
          code: 'meta_error',
          error: `Channel ${req.channel} is not wired yet — use whatsapp or push`,
        };
      default:
        return { success: false, code: 'unexpected', error: 'Unknown channel' };
    }
  },
};
