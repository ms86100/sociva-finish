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

    await supabase.from('audit_log').insert({
      actor_id: user.id,
      action,
      target_type: targetType,
      target_id: targetId,
      society_id: societyId,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}
