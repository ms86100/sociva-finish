// @ts-nocheck
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadAppBootstrap } from '@/lib/app-bootstrap';


export interface BadgeConfigRow {
  id: string;
  tag_key: string;
  badge_label: string;
  color: string;
  priority: number;
  layout_visibility: string[];
  is_active: boolean;
}

/**
 * Fetches badge_config from DB — sorted by priority.
 * Used by ProductListingCard to render badges purely from DB config.
 */
export function useBadgeConfig() {
  const { data: badges = [], isLoading } = useQuery({
    queryKey: ['badge-config'],
    // PERF: served from the shared single-request bootstrap.
    queryFn: async (): Promise<BadgeConfigRow[]> => {
      const { badgeConfigRows } = await loadAppBootstrap();
      return badgeConfigRows as BadgeConfigRow[];
    },
    staleTime: 30 * 60 * 1000, // 30 min — badge config is near-static
  });


  // Fix #6: Memoize return to stabilize object reference for memo comparators
  return useMemo(() => ({ badges, isLoading }), [badges, isLoading]);
}
