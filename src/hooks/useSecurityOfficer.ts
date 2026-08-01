// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

/**
 * Checks if the current user is a security officer for the effective society.
 * Uses the is_security_officer RPC (SECURITY DEFINER) — no client-side role string checks.
 */
export function useSecurityOfficer(roleHint: boolean = true) {
  const { profile, effectiveSocietyId } = useAuth();

  const { data: isSecurityOfficer = false, isLoading } = useQuery({
    queryKey: ['is-security-officer', profile?.id, effectiveSocietyId],
    queryFn: async () => {
      if (!profile?.id || !effectiveSocietyId) return false;
      const { data, error } = await supabase.rpc('is_security_officer', {
        _user_id: profile.id,
        _society_id: effectiveSocietyId,
      });
      if (error) {
        console.error('Error checking security officer status:', error);
        return false;
      }
      return !!data;
    },
    // Fix #8: Only fire RPC when caller signals the user might have this role
    enabled: !!profile?.id && !!effectiveSocietyId && roleHint,
    staleTime: 5 * 60 * 1000,
  });

  return { isSecurityOfficer, isLoading };
}
