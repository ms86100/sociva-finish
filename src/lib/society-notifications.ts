// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';

/**
 * Enqueue push notifications for a list of user IDs via notification_queue,
 * then trigger the process-notification-queue edge function (which has service role access).
 */
async function enqueueAndProcess(
  targets: { id: string }[],
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<void> {
  if (targets.length === 0) return;

  const type = data?.type || 'general';

  // 1. Write to notification_queue (processed by edge function with service role)
  const queueRows = targets.map(t => ({
    user_id: t.id,
    title,
    body,
    type,
    reference_path: data?.path || null,
    payload: data ? (data as Record<string, unknown>) : {},
  }));

  const { error: queueError } = await supabase
    .from('notification_queue')
    .insert(queueRows as any);

  if (queueError) {
    console.error('Failed to enqueue notifications:', queueError);
  }

  // 2. Also write persistent in-app notifications
  const notifRows = targets.map(t => ({
    user_id: t.id,
    title,
    body,
    type,
    reference_path: data?.path || null,
    reference_id: data?.reference_id || null,
  }));

  supabase.from('user_notifications').insert(notifRows as any).then(({ error }) => {
    if (error) console.error('Failed to write notifications:', error);
  });

  // 3. Trigger queue processing (runs with service role internally)
  try {
    await supabase.functions.invoke('process-notification-queue');
  } catch (e) {
    console.warn('Queue processing trigger failed (will retry via cron):', e);
  }
}

/**
 * Notify all society members via push notification
 * Also writes to user_notifications table for persistent inbox
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
