// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';
import { useStatusLabels } from '@/hooks/useStatusLabels';

interface FlowLabel {
  label: string;
  color: string;
}

interface FlowLabelEntry {
  label: string;
  color: string;
  buyerLabel: string | null;
  sellerLabel: string | null;
}

/**
 * Batch-fetches display_label + color from category_status_flows for all distinct status keys.
 * Falls back to useStatusLabels (system_settings / hardcoded) when no workflow label exists.
 *
 * Use this in list views (OrdersPage, SellerOrderCard) where per-order flow loading is too expensive.
 */
export function useFlowStepLabels() {
  const { getOrderStatus } = useStatusLabels();

  const { data: flowLabelMap } = useQuery({
    queryKey: ['flow-step-labels-batch'],
    queryFn: async (): Promise<Record<string, FlowLabelEntry>> => {
      const { data, error } = await supabase
        .from('category_status_flows')
        .select('status_key, display_label, color, buyer_display_label, seller_display_label')
        .eq('parent_group', 'default');

      if (error || !data) return {};

      const map: Record<string, FlowLabelEntry> = {};
      for (const row of data) {
        if (!row.status_key) continue;
        if (!map[row.status_key] || (!map[row.status_key].label && row.display_label)) {
          if (row.display_label) {
            map[row.status_key] = {
              label: row.display_label,
              color: row.color || 'bg-gray-100 text-gray-600',
              buyerLabel: row.buyer_display_label || null,
              sellerLabel: row.seller_display_label || null,
            };
          }
        }
      }
      return map;
    },
    staleTime: jitteredStaleTime(30 * 60 * 1000),
  });

  const getFlowLabel = (statusKey: string, role?: 'buyer' | 'seller'): FlowLabel => {
    const entry = flowLabelMap?.[statusKey];
    if (entry) {
      const label = (role === 'buyer' && entry.buyerLabel)
        ? entry.buyerLabel
        : (role === 'seller' && entry.sellerLabel)
          ? entry.sellerLabel
          : entry.label;
      return { label, color: entry.color };
    }
    return getOrderStatus(statusKey);
  };

  return { getFlowLabel };
}
