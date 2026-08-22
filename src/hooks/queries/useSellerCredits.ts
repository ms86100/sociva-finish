import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  emptySellerCreditSummary,
  mapSellerCreditSummary,
  type SellerCreditSummary,
} from '@/lib/sellerCredits';
import {
  resolveSellerFinancialIds,
  sellerFinancialScopeKey,
} from '@/hooks/queries/useSellerFinancial';

export const SELLER_CREDIT_KEYS = {
  summary: (scope: string) => ['seller-credit-summary', scope] as const,
  activity: (scope: string) => ['seller-credit-activity', scope] as const,
  packages: ['seller-credit-packages'] as const,
  canAccept: (sellerId: string, eventType: string) => ['seller-credit-can-accept', sellerId, eventType] as const,
};

const creditRpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export function useSellerCreditSummary(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
) {
  const ids = resolveSellerFinancialIds(sellerId, portfolioIds);
  const scope = sellerFinancialScopeKey(sellerId, portfolioIds);

  return useQuery({
    queryKey: SELLER_CREDIT_KEYS.summary(scope),
    queryFn: async (): Promise<SellerCreditSummary> => {
      if (ids.length === 0) return emptySellerCreditSummary();
      const { data, error } = await creditRpc('get_seller_credit_summary', {
        p_seller_ids: ids,
      });
      if (error) throw error;
      return mapSellerCreditSummary((data || {}) as Record<string, unknown>);
    },
    enabled: ids.length > 0,
    staleTime: 15_000,
  });
}

export function useSellerCreditActivity(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
) {
  const ids = resolveSellerFinancialIds(sellerId, portfolioIds);
  const scope = sellerFinancialScopeKey(sellerId, portfolioIds);

  return useQuery({
    queryKey: SELLER_CREDIT_KEYS.activity(scope),
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await creditRpc('get_seller_credit_activity', {
        p_seller_ids: ids,
        p_limit: 50,
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: ids.length > 0,
    staleTime: 15_000,
  });
}

export function useSellerCreditPackages() {
  return useQuery({
    queryKey: SELLER_CREDIT_KEYS.packages,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seller_credit_packages')
        .select('id, amount, credits_amount, label, sort_order')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });
}

export function useSellerCreditCanAccept(
  sellerId: string | null | undefined,
  eventType: string,
) {
  return useQuery({
    queryKey: SELLER_CREDIT_KEYS.canAccept(sellerId || '', eventType),
    queryFn: async () => {
      if (!sellerId) return { ok: true, gated: false };
      const { data, error } = await creditRpc('seller_credit_can_accept', {
        p_seller_id: sellerId,
        p_event_type: eventType,
      });
      if (error) throw error;
      return (data || { ok: true }) as { ok: boolean; gated?: boolean; reason?: string };
    },
    enabled: Boolean(sellerId),
    staleTime: 15_000,
  });
}

export function useInvalidateSellerCredits() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['seller-credit-summary'] });
    queryClient.invalidateQueries({ queryKey: ['seller-credit-activity'] });
    queryClient.invalidateQueries({ queryKey: ['seller-credit-can-accept'] });
  }, [queryClient]);
}

export function useSellerCreditRealtime(sellerIds: string[]) {
  const invalidate = useInvalidateSellerCredits();
  useEffect(() => {
    if (sellerIds.length === 0) return;
    const channel = supabase
      .channel(`seller-credits-${sellerIds.join(',')}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seller_credit_accounts' },
        (payload) => {
          const id = (payload.new as { seller_id?: string } | null)?.seller_id
            || (payload.old as { seller_id?: string } | null)?.seller_id;
          if (id && sellerIds.includes(id)) invalidate();
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'seller_credit_ledger' },
        (payload) => {
          const id = (payload.new as { seller_id?: string } | null)?.seller_id
            || (payload.old as { seller_id?: string } | null)?.seller_id;
          if (id && sellerIds.includes(id)) invalidate();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sellerIds.join(','), invalidate]);
}
