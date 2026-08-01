// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface LoyaltyTransaction {
  id: string;
  points: number;
  type: string;
  source: string;
  description: string;
  created_at: string;
}

export function useLoyaltyBalance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['loyalty-balance', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_loyalty_balance');
      if (error) throw error;
      return (data as number) || 0;
    },
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });
}

export function useLoyaltyHistory(limit = 20) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['loyalty-history', user?.id, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_loyalty_history', { _limit: limit });
      if (error) throw error;
      return (data || []) as LoyaltyTransaction[];
    },
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });
}
