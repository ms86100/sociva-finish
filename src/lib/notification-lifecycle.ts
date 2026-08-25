/**
 * Formal notification lifecycle helpers: create / supersede / expire (mark-read).
 * Client-side companion to server trigger `fn_mark_order_notifications_read_on_terminal`.
 */
import { supabase } from '@/integrations/supabase/client';
import { dualNotificationColumns, pickNotificationOrderId } from '@/lib/notification-fields';

export type EnqueueNotificationInput = {
  userId: string;
  title: string;
  body: string;
  type: string;
  path?: string | null;
  data?: Record<string, unknown>;
  /** When true, invoke PNQ after insert (default true). */
  triggerProcess?: boolean;
};

/**
 * Create: enqueue into notification_queue with dual columns.
 * PNQ owns in-app insert + push + WhatsApp — do not dual-write inbox here.
 */
export async function createQueuedNotification(
  input: EnqueueNotificationInput,
): Promise<{ ok: boolean; error?: string }> {
  const cols = dualNotificationColumns({
    path: input.path ?? (input.data?.path as string | undefined) ?? null,
    data: {
      ...(input.data || {}),
      type: input.type,
    },
  });

  // notification_queue has payload + action_url/reference_path (no `data` column)
  const { error } = await supabase.from('notification_queue').insert({
    user_id: input.userId,
    title: input.title,
    body: input.body,
    type: input.type,
    reference_path: cols.reference_path,
    action_url: cols.action_url,
    payload: cols.payload,
  } as never);

  if (error) {
    console.error('[NotifLifecycle] create failed:', error);
    return { ok: false, error: error.message };
  }

  if (input.triggerProcess !== false) {
    try {
      await supabase.functions.invoke('process-notification-queue');
    } catch (e) {
      console.warn('[NotifLifecycle] PNQ trigger failed (cron will retry):', e);
    }
  }
  return { ok: true };
}

export async function createQueuedNotifications(
  inputs: EnqueueNotificationInput[],
): Promise<{ ok: boolean; error?: string }> {
  if (inputs.length === 0) return { ok: true };
  const rows = inputs.map((input) => {
    const cols = dualNotificationColumns({
      path: input.path ?? (input.data?.path as string | undefined) ?? null,
      data: { ...(input.data || {}), type: input.type },
    });
    return {
      user_id: input.userId,
      title: input.title,
      body: input.body,
      type: input.type,
      reference_path: cols.reference_path,
      action_url: cols.action_url,
      payload: cols.payload,
    };
  });

  const { error } = await supabase.from('notification_queue').insert(rows as never);
  if (error) return { ok: false, error: error.message };

  if (inputs.some((i) => i.triggerProcess !== false)) {
    try {
      await supabase.functions.invoke('process-notification-queue');
    } catch (e) {
      console.warn('[NotifLifecycle] PNQ trigger failed:', e);
    }
  }
  return { ok: true };
}

/**
 * Supersede: mark prior unread inbox rows for the same order as read,
 * then optionally enqueue a replacement notification.
 */
export async function supersedeOrderNotifications(opts: {
  userId: string;
  orderId: string;
  replacement?: Omit<EnqueueNotificationInput, 'userId'>;
}): Promise<{ marked: number }> {
  const marked = await expireOrderNotifications({
    userId: opts.userId,
    orderId: opts.orderId,
  });

  if (opts.replacement) {
    await createQueuedNotification({
      ...opts.replacement,
      userId: opts.userId,
      data: {
        ...(opts.replacement.data || {}),
        order_id: opts.orderId,
        orderId: opts.orderId,
        entity_id: opts.orderId,
        entity_type: 'order',
      },
      path: opts.replacement.path ?? `/orders/${opts.orderId}`,
    });
  }
  return marked;
}

/**
 * Expire / mark-read: mark unread order-linked inbox notifications as read.
 * Mirrors server terminal trigger for client-driven reconcile.
 */
export async function expireOrderNotifications(opts: {
  userId?: string;
  orderId: string;
}): Promise<{ marked: number }> {
  let query = supabase
    .from('user_notifications')
    .select('id, data, payload, action_url, reference_path, is_read')
    .eq('is_read', false)
    .limit(100);

  if (opts.userId) query = query.eq('user_id', opts.userId);

  const { data: rows, error } = await query;
  if (error || !rows) {
    console.warn('[NotifLifecycle] expire fetch failed:', error);
    return { marked: 0 };
  }

  const ids = rows
    .filter((r) => pickNotificationOrderId(r as never) === opts.orderId)
    .map((r) => r.id);

  if (ids.length === 0) return { marked: 0 };

  const { error: updErr } = await supabase
    .from('user_notifications')
    .update({ is_read: true } as never)
    .in('id', ids);

  if (updErr) {
    console.warn('[NotifLifecycle] expire update failed:', updErr);
    return { marked: 0 };
  }
  return { marked: ids.length };
}

/** Mark a single notification read (RPC preferred when available). */
export async function markNotificationRead(notificationId: string): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('fn_mark_notification_read', {
      _notification_id: notificationId,
    } as never);
    if (!error) return true;
  } catch { /* fall through */ }

  const { error } = await supabase
    .from('user_notifications')
    .update({ is_read: true } as never)
    .eq('id', notificationId);
  return !error;
}
