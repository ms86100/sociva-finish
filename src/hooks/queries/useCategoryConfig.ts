// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { jitteredStaleTime } from '@/lib/query-utils';
import { fetchCategoryConfigs } from '@/hooks/useCategoryBehavior';

export function useCategoryConfig() {
  return useQuery({
    queryKey: ['category-configs'], // Shared cache key with useCategoryConfigs
    queryFn: fetchCategoryConfigs,
    staleTime: jitteredStaleTime(30 * 60 * 1000), // 30 min + jitter — near-static config
  });
}
