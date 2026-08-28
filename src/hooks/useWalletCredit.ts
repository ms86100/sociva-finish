// @ts-nocheck
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBuyerWallet } from '@/hooks/queries/useWallet';
import { useFinancialCapabilities } from '@/hooks/useFinancialCapabilities';
import { toast } from 'sonner';

/**
 * Sociva Balance — client is display/quote only.
 * Authoritative apply happens inside create_multi_vendor_orders (_wallet_amount).
 */
export function useWalletCredit() {
  const { data: wallet, isLoading: walletLoading } = useBuyerWallet();
  const queryClient = useQueryClient();
  const [appliedAmount, setAppliedAmount] = useState(0);
  const [quotedMax, setQuotedMax] = useState<number | null>(null);
  const { socivaBalanceSpendEnabled, isLoading: capabilitiesLoading } = useFinancialCapabilities();
  const spendEnabled = socivaBalanceSpendEnabled === true;

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
    if (!spendEnabled) {
      setQuotedMax(0);
      setAppliedAmount(0);
      return 0;
    }
    const amount = Math.max(0, payable);
    try {
      const data = await quoteMutation.mutateAsync(amount);
      const max = Math.max(0, Number(data?.max_amount ?? 0));
      setQuotedMax(max);
      if (appliedAmount > max) setAppliedAmount(max);
      return max;
    } catch (err) {
      console.error('[Wallet] quote failed:', err);
      // Financial authority stays server-side. A failed quote cannot fall back
      // to client arithmetic.
      setQuotedMax(0);
      setAppliedAmount(0);
      return 0;
    }
  }, [quoteMutation, appliedAmount, spendEnabled]);

  const clearApplied = useCallback(() => {
    setAppliedAmount(0);
  }, []);

  const toggleCredit = useCallback(async (payableAfterCouponLoyalty: number) => {
    if (appliedAmount > 0) {
      setAppliedAmount(0);
      return;
    }
    if (status !== 'active') {
      toast.error('Sociva Balance is frozen on this account.');
      return;
    }
    if (!spendEnabled) {
      toast.info('Sociva Balance spending is temporarily unavailable.');
      return;
    }
    const max = await refreshQuote(payableAfterCouponLoyalty);
    setAppliedAmount(max);
  }, [appliedAmount, refreshQuote, spendEnabled, status]);

  const releaseForOrders = useCallback(async (orderIds: string[]) => {
    try {
      await releaseMutation.mutateAsync(orderIds);
    } catch (err: any) {
      console.error('[Wallet] release failed:', err);
      toast.error('Could not release Sociva Balance hold. Contact support if balance stays pending.', {
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
    capabilitiesLoading,
    spendEnabled,
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
