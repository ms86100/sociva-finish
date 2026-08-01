// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ActionTypeMapping {
  action_type: string;
  transaction_type: string;
  checkout_mode: string;
  creates_order: boolean;
  requires_price: boolean;
  requires_availability: boolean;
  cta_label: string;
  cta_short_label: string;
  is_active: boolean;
}

const CHECKOUT_MODE_DESCRIPTIONS: Record<string, string> = {
  cart: 'Buyers purchase directly with quantity',
  booking: 'Buyers select date & time slots',
  inquiry: 'Buyers send a request, you respond with details',
  contact: 'Buyers contact you directly — no transaction',
};

export function useActionTypeMap() {
  return useQuery({
    queryKey: ['action-type-workflow-map'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('action_type_workflow_map')
        .select('*')
        .eq('is_active', true)
        .order('action_type');
      if (error) throw error;
      return (data || []) as ActionTypeMapping[];
    },
    staleTime: 1000 * 60 * 30,
  });
}

export function useCategoryAllowedActions(categoryConfigId: string | null) {
  return useQuery({
    queryKey: ['category-allowed-actions', categoryConfigId],
    queryFn: async () => {
      if (!categoryConfigId) return null;
      const { data, error } = await (supabase as any)
        .from('category_allowed_action_types')
        .select('action_type')
        .eq('category_config_id', categoryConfigId);
      if (error) throw error;
      const list = (data || []).map((d: any) => d.action_type as string);
      if (list.length === 0) {
        console.warn(`[useActionTypeMap] No allowed action types found for category_config_id: ${categoryConfigId} — falling back to all`);
      }
      return list;
    },
    enabled: !!categoryConfigId,
    staleTime: 1000 * 60 * 30,
  });
}

export function getCheckoutModeDescription(mode: string): string {
  return CHECKOUT_MODE_DESCRIPTIONS[mode] || mode;
}
