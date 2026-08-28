// @ts-nocheck
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLoyaltyBalance } from '@/hooks/queries/useLoyalty';
import { useFinancialCapabilities } from '@/hooks/useFinancialCapabilities';
import { toast } from 'sonner';

/**
 * Phase 1 platform-funded loyalty — client is display/quote only.
 * Authoritative redeem happens inside create_multi_vendor_orders (_loyalty_points).
 */
export function useLoyaltyRedeem() {
  const { buyerLoyaltyRedeemEnabled } = useFinancialCapabilities();
  const { data: balance = 0, isLoading: balanceLoading } = useLoyaltyBalance();
  const queryClient = useQueryClient();
  const [appliedPoints, setAppliedPoints] = useState(0);
  const [quotedMax, setQuotedMax] = useState<number | null>(null);
  const redeemEnabled = buyerLoyaltyRedeemEnabled === true;

  const quoteMutation = useMutation({
    mutationFn: async (cartAmountAfterCoupon: number) => {
      const { data, error } = await supabase.rpc('quote_loyalty_redemption', {
        _cart_amount_after_coupon: cartAmountAfterCoupon,
      });
      if (error) throw error;
      return data as {
        success?: boolean;
        max_points?: number;
        available_points?: number;
        discount_rupees?: number;
        error?: string;
      };
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      if (!orderIds?.length) return null;
      const { data, error } = await supabase.rpc('release_loyalty_for_orders', {
        _order_ids: orderIds,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-balance'] });
      queryClient.invalidateQueries({ queryKey: ['loyalty-history'] });
    },
  });

  const refreshQuote = useCallback(async (orderSubtotal: number) => {
    if (!redeemEnabled) {
      setQuotedMax(0);
      setAppliedPoints(0);
      return 0;
    }
    const amount = Math.max(0, orderSubtotal);
    try {
      const data = await quoteMutation.mutateAsync(amount);
      const max = Math.max(0, Number(data?.max_points ?? 0));
      setQuotedMax(max);
      if (appliedPoints > max) setAppliedPoints(max);
      return max;
    } catch (err) {
      console.error('[Loyalty] quote failed:', err);
      // Fallback: local cap from cached balance (server still enforces on checkout)
      const max = Math.min(balance, Math.floor(amount));
      setQuotedMax(max);
      return max;
    }
  }, [quoteMutation, appliedPoints, balance, redeemEnabled]);

  const applyPoints = useCallback((maxOrderAmount: number) => {
    if (!redeemEnabled) return;
    const cap = quotedMax != null ? quotedMax : Math.min(balance, Math.floor(maxOrderAmount));
    setAppliedPoints(Math.min(balance, Math.floor(maxOrderAmount), cap));
  }, [balance, quotedMax, redeemEnabled]);

  const clearAppliedPoints = useCallback(() => {
    setAppliedPoints(0);
  }, []);

  const togglePoints = useCallback(async (orderSubtotal: number) => {
    if (!redeemEnabled) return;
    if (appliedPoints > 0) {
      setAppliedPoints(0);
      return;
    }
    const max = await refreshQuote(orderSubtotal);
    setAppliedPoints(max);
  }, [appliedPoints, refreshQuote, redeemEnabled]);

  /** @deprecated Redemption is server-side at checkout — kept as no-op for call-site safety */
  const redeemPoints = useCallback(async (_points: number, _orderId: string) => {
    console.warn('[Loyalty] redeemPoints is deprecated — checkout RPC applies loyalty');
  }, []);

  const releaseForOrders = useCallback(async (orderIds: string[]) => {
    try {
      await releaseMutation.mutateAsync(orderIds);
    } catch (err: any) {
      console.error('[Loyalty] release failed:', err);
      toast.error('Could not release loyalty hold. Contact support if points stay pending.', {
        id: 'loyalty-release-fail',
      });
    }
  }, [releaseMutation]);

  return {
    balance: redeemEnabled ? balance : 0,
    balanceLoading,
    appliedPoints: redeemEnabled ? appliedPoints : 0,
    loyaltyDiscount: redeemEnabled ? appliedPoints : 0,
    quotedMax: redeemEnabled ? quotedMax : 0,
    redeemEnabled,
    applyPoints,
    clearAppliedPoints,
    togglePoints,
    refreshQuote,
    redeemPoints,
    releaseForOrders,
    isRedeeming: false,
    isQuoting: quoteMutation.isPending,
  };
}
