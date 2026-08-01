// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface SearchSuggestion {
  term: string;
  count: number;
}

/**
 * Fetches popular search terms from the user's society via DB-side aggregation.
 * Powers "People in your society also searched for..." suggestions.
 */
export function useCommunitySearchSuggestions(limit = 8) {
  const { effectiveSocietyId } = useAuth();

  return useQuery({
    queryKey: ['community-search-suggestions', effectiveSocietyId, limit],
    queryFn: async (): Promise<SearchSuggestion[]> => {
      const { data, error } = await supabase.rpc('get_society_search_suggestions', {
        _society_id: effectiveSocietyId!,
        _limit: limit,
      });

      if (error) {
        console.warn('[CommunitySearchSuggestions] RPC error:', error.message);
        return [];
      }

      return (data as any[] || []).map((row: any) => ({
        term: row.term,
        count: Number(row.count),
      }));
    },
    enabled: !!effectiveSocietyId,
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });
}
