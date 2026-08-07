// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface BuyerWallet {
  success?: boolean;
  cash_available: number;
  promo_available: number;
  cash_pending: number;
  promo_pending: number;
  total_available: number;
  status: string;
  nearest_promo_expires_at: string | null;
  lifetime_credited?: number;
  lifetime_spent?: number;
}

export interface WalletHistoryItem {
  id: string;
  type: string;
  description: string;
  reference_type: string | null;
  reference_id: string | null;
  created_at: string;
  signed_amount: number;
}

export function useBuyerWallet() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['buyer-wallet', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_buyer_wallet');
      if (error) throw error;
      const w = (data || {}) as BuyerWallet;
      return {
        cash_available: Number(w.cash_available || 0),
        promo_available: Number(w.promo_available || 0),
        cash_pending: Number(w.cash_pending || 0),
        promo_pending: Number(w.promo_pending || 0),
        total_available: Number(w.total_available || 0),
        status: w.status || 'active',
        nearest_promo_expires_at: w.nearest_promo_expires_at || null,
        lifetime_credited: Number(w.lifetime_credited || 0),
        lifetime_spent: Number(w.lifetime_spent || 0),
      } as BuyerWallet;
    },
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });
}

export function useWalletHistory(limit = 20) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['wallet-history', user?.id, limit],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_wallet_history', { _limit: limit });
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      return rows as WalletHistoryItem[];
    },
    enabled: !!user?.id,
    staleTime: 2 * 60_000,
  });
}
