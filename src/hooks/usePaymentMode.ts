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
        .from('admin_settings')
        .select('value, is_active')
        .eq('key', 'payment_gateway_mode')
        .maybeSingle();

      if (error || !data?.value || !data.is_active) return 'upi_deep_link';
      return (data.value === 'razorpay' ? 'razorpay' : 'upi_deep_link') as PaymentGatewayMode;
    },
    staleTime: jitteredStaleTime(10 * 60 * 1000),
  });

  return {
    mode: data ?? 'upi_deep_link' as PaymentGatewayMode,
    isLoading,
    isUpiDeepLink: (data ?? 'upi_deep_link') === 'upi_deep_link',
    isRazorpay: (data ?? 'upi_deep_link') === 'razorpay',
  };
}
