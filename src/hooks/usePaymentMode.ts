// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export type PaymentGatewayMode = 'upi_deep_link' | 'razorpay';

export function usePaymentMode() {
  const { data, isLoading } = useQuery({
    queryKey: ['payment-gateway-mode'],
    queryFn: async (): Promise<PaymentGatewayMode> => {
      const { data, error } = await supabase
        .rpc('get_public_payment_mode' as any);

      if (error) {
        console.error('[PaymentMode] Failed to load public payment mode:', error);
        return 'upi_deep_link';
      }
      return (data === 'razorpay' ? 'razorpay' : 'upi_deep_link') as PaymentGatewayMode;
    },
    staleTime: jitteredStaleTime(60 * 1000),
    refetchOnMount: 'always',
  });

  return {
    mode: data ?? 'upi_deep_link' as PaymentGatewayMode,
    isLoading,
    isUpiDeepLink: (data ?? 'upi_deep_link') === 'upi_deep_link',
    isRazorpay: (data ?? 'upi_deep_link') === 'razorpay',
  };
}
