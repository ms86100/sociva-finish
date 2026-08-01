// @ts-nocheck
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jitteredStaleTime } from '@/lib/query-utils';
import { fetchCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useTypewriterPlaceholder } from '@/hooks/useTypewriterPlaceholder';

/**
 * Context-aware search placeholder with typewriter animation.
 * 
 * Fix #4: Uses lightweight category_config query instead of
 * useProductsByCategory(200) which was fetching full product rows.
 */
export type SearchContext =
  | 'home'
  | 'marketplace'
  | 'society'
  | 'visitors'
  | 'finances'
  | 'construction'
  | 'disputes'
  | 'workforce'
  | 'parking'
  | 'bulletin'
  | 'deliveries'
  | 'maintenance'
  | 'search';

const CONTEXT_WORDS: Record<string, string[]> = {
  society: ['visitors', 'parking', 'finances', 'snags', 'disputes', 'workers', 'notices'],
  visitors: ['guest name', 'flat number', 'OTP code'],
  finances: ['expense', 'income', 'budget', 'receipt'],
  construction: ['milestone', 'tower', 'progress', 'document'],
  disputes: ['complaint', 'ticket', 'resolution'],
  workforce: ['maid', 'driver', 'plumber', 'electrician'],
  parking: ['vehicle number', 'slot', 'sticker'],
  bulletin: ['announcement', 'discussion', 'event', 'poll'],
  deliveries: ['order', 'rider', 'tracking'],
  maintenance: ['dues', 'payment', 'receipt'],
};

export function useSearchPlaceholder(context: SearchContext = 'home') {
  // Fix #13: Reuse the shared 'category-configs' query key to avoid duplicate fetch
  const { data: categoryConfigs = [] } = useQuery({
    queryKey: ['category-configs'],
    queryFn: fetchCategoryConfigs,
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });

  const categoryNames = useMemo(
    () => categoryConfigs.map((c: any) => c.displayName || c.display_name),
    [categoryConfigs]
  );

  const words = useMemo(() => {
    if (['home', 'marketplace', 'search'].includes(context)) {
      return categoryNames.length > 0 ? categoryNames : ['products'];
    }
    return CONTEXT_WORDS[context] || ['items'];
  }, [context, categoryNames]);

  const prefix = 'Search "';

  return useTypewriterPlaceholder(words, { prefix, suffix: '"' });
}