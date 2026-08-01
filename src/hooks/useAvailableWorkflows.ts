// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface AvailableWorkflow {
  key: string;
  label: string;
  stepCount: number;
}

const formatLabel = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

async function fetchAvailableWorkflows(): Promise<AvailableWorkflow[]> {
  const { data, error } = await supabase
    .from('category_status_flows')
    .select('transaction_type, status_key')
    .eq('is_deprecated', false);

  if (error) throw error;

  // Group by transaction_type, count steps, deduplicate
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const key = row.transaction_type;
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  // Deduplicate step counts (same workflow appears across parent_groups)
  // Take max step count per workflow key
  const workflows: AvailableWorkflow[] = [];
  const seen = new Set<string>();

  for (const [key, count] of map.entries()) {
    if (seen.has(key)) continue;
    seen.add(key);
    workflows.push({
      key,
      label: formatLabel(key),
      stepCount: count,
    });
  }

  return workflows.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Fetches distinct workflow keys from `category_status_flows`.
 * Used by CategoryManager to populate the workflow selector dropdown.
 */
export function useAvailableWorkflows() {
  return useQuery({
    queryKey: ['available-workflows'],
    queryFn: fetchAvailableWorkflows,
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });
}
