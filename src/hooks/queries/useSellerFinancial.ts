// @ts-nocheck
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  emptySellerFinancialSummary,
  mapSellerFinancialSummary,
  type SellerFinancialSummary,
} from '@/lib/sellerFinancialTruth';
import { isPortfolioSellerId } from '@/lib/seller-order-board';

export const SELLER_FINANCIAL_KEYS = {
  summary: (scope: string) => ['seller-financial-summary', scope] as const,
  activity: (scope: string) => ['seller-financial-activity', scope] as const,
  withdrawals: (scope: string) => ['seller-withdrawal-requests', scope] as const,
  payoutReady: ['seller-payout-readiness'] as const,
};

export function sellerFinancialScopeKey(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
): string {
  if (isPortfolioSellerId(sellerId)) return ['portfolio', ...(portfolioIds || [])].join(',');
  return sellerId || '';
}

export function resolveSellerFinancialIds(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
): string[] {
  if (isPortfolioSellerId(sellerId)) return portfolioIds || [];
  return sellerId ? [sellerId] : [];
}

const financialRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export function useSellerFinancialSummary(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
) {
  const ids = resolveSellerFinancialIds(sellerId, portfolioIds);
  const scope = sellerFinancialScopeKey(sellerId, portfolioIds);

  return useQuery({
    queryKey: SELLER_FINANCIAL_KEYS.summary(scope),
    queryFn: async (): Promise<SellerFinancialSummary> => {
      if (ids.length === 0) return emptySellerFinancialSummary();
      const { data, error } = await financialRpc('get_seller_financial_summary', {
        p_seller_ids: ids,
      });
      if (error) throw error;
      return mapSellerFinancialSummary((data || {}) as Record<string, unknown>);
    },
    enabled: ids.length > 0,
    staleTime: 15_000,
  });
}

export function useSellerFinancialActivity(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
) {
  const ids = resolveSellerFinancialIds(sellerId, portfolioIds);
  const scope = sellerFinancialScopeKey(sellerId, portfolioIds);

  return useQuery({
    queryKey: SELLER_FINANCIAL_KEYS.activity(scope),
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await financialRpc('get_seller_financial_activity', {
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

export function useSellerPayoutReadiness() {
  return useQuery({
    queryKey: SELLER_FINANCIAL_KEYS.payoutReady,
    queryFn: async () => {
      const { data, error } = await financialRpc('get_seller_payout_readiness');
      if (error) throw error;
      const raw = (data || {}) as Record<string, unknown>;
      const enabled = raw.seller_payout_enabled === true;
      const routeReady = raw.provider_payout_mode === 'razorpay_route_deferred';
      return {
        sellerPayoutEnabled: enabled,
        razorpayRouteMode: routeReady,
        canRequestWithdrawal: enabled && routeReady,
        reason: !enabled
          ? 'Withdrawals are not enabled yet. Online earnings stay as Available until payouts are production-ready.'
          : !routeReady
            ? 'Razorpay Route is not the active payout mode. Digital withdrawal is unavailable.'
            : null,
      };
    },
    staleTime: 60_000,
  });
}

export function useSellerWithdrawalRequests(
  sellerId: string | null | undefined,
  portfolioIds?: string[] | null,
) {
  const ids = resolveSellerFinancialIds(sellerId, portfolioIds);
  const scope = sellerFinancialScopeKey(sellerId, portfolioIds);

  return useQuery({
    queryKey: SELLER_FINANCIAL_KEYS.withdrawals(scope),
    queryFn: async () => {
      if (ids.length === 0) return [];
      const { data, error } = await financialRpc('list_seller_withdrawal_requests', {
        p_seller_ids: ids,
      });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
    enabled: ids.length > 0,
    staleTime: 15_000,
  });
}

export function useInvalidateSellerFinancial() {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ['seller-financial-summary'] });
    qc.invalidateQueries({ queryKey: ['seller-financial-activity'] });
    qc.invalidateQueries({ queryKey: ['seller-withdrawal-requests'] });
    qc.invalidateQueries({ queryKey: ['seller-dashboard-stats'] });
    qc.invalidateQueries({ queryKey: ['seller-order-filter-counts'] });
    qc.invalidateQueries({ queryKey: ['seller-refund-requests'] });
    qc.invalidateQueries({ queryKey: ['seller-payout-readiness'] });
  }, [qc]);
}

export function useSellerFinancialRealtime(sellerIds: string[]) {
  const invalidate = useInvalidateSellerFinancial();
  const key = sellerIds.join(',');
  useEffect(() => {
    if (sellerIds.length === 0) return;
    const channel = supabase
      .channel(`seller-finance-${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_settlements' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'refund_requests' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'seller_withdrawal_requests' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [key, invalidate]);
}
