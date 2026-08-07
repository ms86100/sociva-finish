// @ts-nocheck
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBuyerWallet } from '@/hooks/queries/useWallet';
import { toast } from 'sonner';

/**
 * Sociva Credit — client is display/quote only.
 * Authoritative apply happens inside create_multi_vendor_orders (_wallet_amount).
 */
export function useWalletCredit() {
  const { data: wallet, isLoading: walletLoading } = useBuyerWallet();
  const queryClient = useQueryClient();
  const [appliedAmount, setAppliedAmount] = useState(0);
  const [quotedMax, setQuotedMax] = useState<number | null>(null);

  const balance = Number(wallet?.total_available || 0);
  const cashAvailable = Number(wallet?.cash_available || 0);
  const promoAvailable = Number(wallet?.promo_available || 0);
  const status = wallet?.status || 'active';

  const quoteMutation = useMutation({
    mutationFn: async (payableAfterCouponLoyalty: number) => {
      const { data, error } = await supabase.rpc('quote_wallet_application', {
        _payable_after_coupon_loyalty: payableAfterCouponLoyalty,
      });
      if (error) throw error;
      return data as {
        success?: boolean;
        max_amount?: number;
        cash_available?: number;
        promo_available?: number;
        plan?: { promo_amount?: number; cash_amount?: number; total?: number };
        error?: string;
      };
    },
  });

  const releaseMutation = useMutation({
    mutationFn: async (orderIds: string[]) => {
      if (!orderIds?.length) return null;
      const { data, error } = await supabase.rpc('release_wallet_for_orders', {
        _order_ids: orderIds,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['buyer-wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet-history'] });
    },
  });

  const refreshQuote = useCallback(async (payable: number) => {
    const amount = Math.max(0, payable);
    try {
      const data = await quoteMutation.mutateAsync(amount);
      const max = Math.max(0, Number(data?.max_amount ?? 0));
      setQuotedMax(max);
      if (appliedAmount > max) setAppliedAmount(max);
      return max;
    } catch (err) {
      console.error('[Wallet] quote failed:', err);
      const max = Math.min(balance, Math.round(amount * 100) / 100);
      setQuotedMax(max);
      return max;
    }
  }, [quoteMutation, appliedAmount, balance]);

  const clearApplied = useCallback(() => {
    setAppliedAmount(0);
  }, []);

  const toggleCredit = useCallback(async (payableAfterCouponLoyalty: number) => {
    if (appliedAmount > 0) {
      setAppliedAmount(0);
      return;
    }
    if (status !== 'active') {
      toast.error('Sociva Credit is frozen on this account.');
      return;
    }
    const max = await refreshQuote(payableAfterCouponLoyalty);
    setAppliedAmount(max);
  }, [appliedAmount, refreshQuote, status]);

  const releaseForOrders = useCallback(async (orderIds: string[]) => {
    try {
      await releaseMutation.mutateAsync(orderIds);
    } catch (err: any) {
      console.error('[Wallet] release failed:', err);
      toast.error('Could not release Sociva Credit hold. Contact support if balance stays pending.', {
        id: 'wallet-release-fail',
      });
    }
  }, [releaseMutation]);

  return {
    balance,
    cashAvailable,
    promoAvailable,
    status,
    walletLoading,
    appliedAmount,
    quotedMax,
    nearestPromoExpiresAt: wallet?.nearest_promo_expires_at || null,
    clearApplied,
    toggleCredit,
    refreshQuote,
    releaseForOrders,
    isQuoting: quoteMutation.isPending,
  };
}
