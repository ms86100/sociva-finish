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

  await createQueuedNotifications(
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

  try {
    await supabase.functions.invoke('process-notification-queue');
  } catch (e) {
    console.warn('Queue processing trigger failed (will retry via cron):', e);
  }
}

/**
 * Notify all society members via push notification
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
