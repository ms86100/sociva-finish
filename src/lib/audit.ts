// @ts-nocheck
import { supabase } from '@/integrations/supabase/client';

export async function logAudit(
  action: string,
  targetType: string,
  targetId: string,
  societyId: string,
  metadata?: Record<string, any>
) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // P0: never client-INSERT into audit_log — allowlisted SECURITY DEFINER RPC only
    const { error } = await supabase.rpc('write_audit_event', {
      p_action: action,
      p_target_type: targetType,
      p_target_id: targetId,
      p_society_id: societyId || null,
      p_metadata: metadata || {},
    });
    if (error) console.error('Audit log error:', error);
  } catch (error) {
    console.error('Audit log error:', error);
  }
}
