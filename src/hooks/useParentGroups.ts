// @ts-nocheck
import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateAppBootstrap, loadAppBootstrap } from '@/lib/app-bootstrap';


export interface ParentGroupRow {
  id: string;
  slug: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  layout_type: 'ecommerce' | 'food' | 'service';
  requires_license: boolean;
  license_mandatory: boolean;
  license_type_name: string | null;
  license_description: string | null;
  placeholder_hint: string | null;
  created_at: string;
  updated_at: string;
}

// Convenience type matching the old PARENT_GROUPS constant shape
export interface ParentGroupInfo {
  value: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  layoutType: 'ecommerce' | 'food' | 'service';
}

export function useParentGroups() {
  const queryClient = useQueryClient();
  const { data: groups = [], isLoading, refetch } = useQuery({
    queryKey: ['parent-groups'],
    // PERF: served from the shared single-request bootstrap.
    queryFn: async (): Promise<ParentGroupRow[]> => {
      const { parentGroupRows } = await loadAppBootstrap();
      return parentGroupRows as ParentGroupRow[];
    },
    staleTime: 30 * 60 * 1000, // 30 min — parent groups are near-static
  });

  // Admin CRUD must bypass bootstrap memory/localStorage cache or new sections stay invisible
  const refresh = useCallback(async () => {
    invalidateAppBootstrap();
    queryClient.removeQueries({ queryKey: ['parent-groups'] });
    return refetch();
  }, [queryClient, refetch]);


  // Map to the same shape as the old PARENT_GROUPS constant for easy migration
  const parentGroupInfos: ParentGroupInfo[] = useMemo(() => {
    return groups.map((g) => ({
      value: g.slug,
      label: g.name,
      icon: g.icon,
      color: g.color,
      description: g.description,
      layoutType: (g.layout_type as 'ecommerce' | 'food' | 'service') || 'ecommerce',
    }));
  }, [groups]);

  // Fix #20: Memoize lookup functions to prevent consumer re-renders
  const getGroupBySlug = useCallback((slug: string | null): ParentGroupInfo | undefined => {
    if (!slug) return undefined;
    return parentGroupInfos.find((g) => g.value === slug);
  }, [parentGroupInfos]);

  const getLayoutType = useCallback((slug: string | null): 'ecommerce' | 'food' | 'service' => {
    if (!slug) return 'ecommerce';
    const group = groups.find((g) => g.slug === slug);
    return (group?.layout_type as 'ecommerce' | 'food' | 'service') || 'ecommerce';
  }, [groups]);

  // Build a slug -> layout_type map for fast lookups
  const layoutMap = useMemo(() => {
    const map: Record<string, 'ecommerce' | 'food' | 'service'> = {};
    for (const g of groups) {
      map[g.slug] = (g.layout_type as 'ecommerce' | 'food' | 'service') || 'ecommerce';
    }
    return map;
  }, [groups]);

  return {
    groups,
    parentGroupInfos,
    isLoading,
    refresh,
    getGroupBySlug,
    getLayoutType,
    layoutMap,
  };
}
