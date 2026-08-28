// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export interface FinancialCapabilities {
  payment_gateway_mode?: string;
  online_payment_enabled?: boolean;
  wallet_refund_credit_enabled?: boolean;
  wallet_spend_enabled?: boolean;
  seller_payout_enabled?: boolean;
  sociva_balance_refund_enabled?: boolean;
  sociva_balance_spend_enabled?: boolean;
  buyer_loyalty_redeem_enabled?: boolean;
}

export function useFinancialCapabilities() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['financial-capabilities'],
    queryFn: async (): Promise<FinancialCapabilities> => {
      const { data: caps, error: rpcError } = await supabase.rpc('get_financial_capabilities');
      if (rpcError) throw rpcError;
      return (caps || {}) as FinancialCapabilities;
    },
    staleTime: jitteredStaleTime(30_000),
    refetchOnMount: 'always',
  });

  return {
    capabilities: data,
    isLoading,
    error,
    onlinePaymentEnabled: data?.online_payment_enabled === true,
    socivaBalanceSpendEnabled: data?.sociva_balance_spend_enabled === true,
    socivaBalanceRefundEnabled: data?.sociva_balance_refund_enabled === true,
    buyerLoyaltyRedeemEnabled: data?.buyer_loyalty_redeem_enabled === true,
  };
}
