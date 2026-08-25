// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { jitteredStaleTime } from '@/lib/query-utils';

export type PaymentGatewayMode = 'off' | 'upi_deep_link' | 'razorpay';

function normalizePaymentMode(raw: unknown): PaymentGatewayMode {
  if (raw === 'off' || raw === 'razorpay' || raw === 'upi_deep_link') return raw;
  return 'upi_deep_link';
}

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
      return normalizePaymentMode(data);
    },
    staleTime: jitteredStaleTime(60 * 1000),
    refetchOnMount: 'always',
  });

  const mode = data ?? ('upi_deep_link' as PaymentGatewayMode);

  return {
    mode,
    isLoading,
    isOff: mode === 'off',
    isOnlineEnabled: mode !== 'off',
    isUpiDeepLink: mode === 'upi_deep_link',
    isRazorpay: mode === 'razorpay',
  };
}
