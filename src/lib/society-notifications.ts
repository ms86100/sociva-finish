// @ts-nocheck
import { createQueuedNotifications } from '@/lib/notification-lifecycle';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enqueue society notifications via notification_queue only (PNQ owns inbox + push).
 * No dual-write to user_notifications — that caused duplicate inbox rows (P1-4).
 */
async function enqueueAndProcess(
  targets: { id: string }[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (targets.length === 0) return;

  const type = data?.type || 'general';
  const path = data?.path || null;

  const result = await createQueuedNotifications(
    targets.map((t) => ({
      userId: t.id,
      title,
      body,
      type,
      path,
      data: data ? { ...data } : {},
      triggerProcess: false,
    })),
  );

  if (!result.ok) {
    throw new Error(result.error || 'Failed to enqueue society notifications');
  }

  try {
    await supabase.functions.invoke('process-notification-queue');
  } catch (e) {
    console.warn('Queue processing trigger failed (will retry via cron):', e);
  }
}

/**
 * Notify all society members via push notification.
 * Prefer admin RPC (bypasses notification_queue self-only RLS).
 */
export async function notifySocietyMembers(
  societyId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  excludeUserId?: string,
  options?: { includeUnapproved?: boolean }
): Promise<void> {
  try {
    const type = data?.type || 'general';
    const path = data?.path || null;

    const { data: rpcData, error: rpcError } = await supabase.rpc('admin_notify_society_members', {
      p_society_id: societyId,
      p_title: title,
      p_body: body,
      p_type: type,
      p_payload: data ? { ...data } : {},
      p_include_unapproved: options?.includeUnapproved ?? false,
      p_path: path,
      p_exclude_user_id: excludeUserId ?? null,
    });

    if (!rpcError) {
      const notified = Number((rpcData as any)?.notified_count ?? 0);
      if (notified > 0) {
        try {
          await supabase.functions.invoke('process-notification-queue');
        } catch (e) {
          console.warn('Queue processing trigger failed (will retry via cron):', e);
        }
      }
      return;
    }

    // Non-admin fallback: only works for self under RLS (legacy / limited)
    console.warn('admin_notify_society_members unavailable, falling back:', rpcError.message);
    let query = supabase
      .from('profiles')
      .select('id')
      .eq('society_id', societyId);

    if (!options?.includeUnapproved) {
      query = query.eq('verification_status', 'approved');
    }

    const { data: members } = await query;
    if (!members || members.length === 0) return;

    const targets = excludeUserId
      ? members.filter(m => m.id !== excludeUserId)
      : members;

    await enqueueAndProcess(targets, title, body, data);
  } catch (err) {
    console.error('Failed to notify society members:', err);
    throw err;
  }
}

/**
 * Notify admins of a society
 */
export async function notifySocietyAdmins(
  societyId: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  try {
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    if (!adminRoles || adminRoles.length === 0) return;

    const adminIds = adminRoles.map(r => r.user_id);

    const { data: adminProfiles } = await supabase
      .from('profiles')
      .select('id')
      .eq('society_id', societyId)
      .in('id', adminIds);

    if (!adminProfiles) return;

    await enqueueAndProcess(adminProfiles, title, body, data);
  } catch (err) {
    console.error('Failed to notify admins:', err);
  }
}
