// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface WorkflowMapEntry {
  listing_type: string;
  workflow_key: string;
  is_conditional: boolean;
  condition_note: string | null;
}

async function fetchWorkflowMap(): Promise<WorkflowMapEntry[]> {
  const { data, error } = await supabase
    .from('listing_type_workflow_map')
    .select('listing_type, workflow_key, is_conditional, condition_note');
  if (error) throw error;
  return (data ?? []) as WorkflowMapEntry[];
}

/**
 * DB-driven hook to fetch listing type → workflow key mapping.
 * Cached for 10 min with jitter to prevent stampede.
 */
export function useWorkflowMap() {
  const query = useQuery({
    queryKey: ['listing-type-workflow-map'],
    queryFn: fetchWorkflowMap,
    staleTime: jitteredStaleTime(30 * 60 * 1000),
  });

  return query;
}

/** Pure lookup function for use with fetched map data */
export function getWorkflowKeyFromMap(
  map: WorkflowMapEntry[] | undefined,
  listingType: string
): WorkflowMapEntry | undefined {
  return map?.find(m => m.listing_type === listingType);
}
