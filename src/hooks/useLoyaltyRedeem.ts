// @ts-nocheck
import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLoyaltyBalance } from '@/hooks/queries/useLoyalty';
import { toast } from 'sonner';

export function useLoyaltyRedeem() {
  const { data: balance = 0, isLoading: balanceLoading } = useLoyaltyBalance();
  const queryClient = useQueryClient();
  const [appliedPoints, setAppliedPoints] = useState(0);

  const redeemMutation = useMutation({
    mutationFn: async ({ points, orderId }: { points: number; orderId: string }) => {
      const { data, error } = await supabase.rpc('redeem_loyalty_points', {
        _points: points,
        _order_id: orderId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['loyalty-balance'] });
      queryClient.invalidateQueries({ queryKey: ['loyalty-history'] });
    },
    onError: (err: any) => {
      console.error('[Loyalty] Redemption failed:', err);
      toast.error('Could not redeem loyalty points. They will be restored.', { id: 'loyalty-redeem-fail' });
    },
  });

  const applyPoints = useCallback((maxOrderAmount: number) => {
    const pointsToApply = Math.min(balance, Math.floor(maxOrderAmount));
    setAppliedPoints(pointsToApply);
  }, [balance]);

  const clearAppliedPoints = useCallback(() => {
    setAppliedPoints(0);
  }, []);

  const togglePoints = useCallback((orderSubtotal: number) => {
    if (appliedPoints > 0) {
      setAppliedPoints(0);
    } else {
      const pointsToApply = Math.min(balance, Math.floor(orderSubtotal));
      setAppliedPoints(pointsToApply);
    }
  }, [appliedPoints, balance]);

  const redeemPoints = useCallback(async (points: number, orderId: string) => {
    if (points <= 0) return;
    await redeemMutation.mutateAsync({ points, orderId });
  }, [redeemMutation]);

  return {
    balance,
    balanceLoading,
    appliedPoints,
    loyaltyDiscount: appliedPoints, // 1 point = ₹1
    applyPoints,
    clearAppliedPoints,
    togglePoints,
    redeemPoints,
    isRedeeming: redeemMutation.isPending,
  };
}
