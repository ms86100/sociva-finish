// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

interface SocietyStats {
  families: number;
  sellers: number;
  isVerified: boolean;
}

export function useSocietyStats(
  societyId: string | null | undefined,
  enabled: boolean = true,
): SocietyStats | null {
  const { data = null } = useQuery({
    queryKey: ['society-header-stats', societyId],
    queryFn: async (): Promise<SocietyStats> => {
      const [{ count: sellerCount }, { data: society }] = await Promise.all([
        supabase
          .from('seller_profiles')
          .select('id', { count: 'exact', head: true })
          .eq('society_id', societyId!)
          .eq('verification_status', 'approved'),
        supabase
          .from('societies')
          .select('member_count, is_verified')
          .eq('id', societyId!)
          .maybeSingle(),
      ]);
      return {
        families: society?.member_count || 0,
        sellers: sellerCount || 0,
        isVerified: society?.is_verified || false,
      };
    },
    enabled: !!societyId && enabled,
    staleTime: jitteredStaleTime(5 * 60_000),
  });
  return data;
}
