import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOptionalAuth } from '@/contexts/AuthContext';
import { useMarketplaceData } from '@/hooks/queries/useMarketplaceData';

export function YourConversationsRow({
  sellerNames,
}: {
  sellerNames?: ReadonlyMap<string, string>;
}) {
  const user = useOptionalAuth()?.user;
  const navigate = useNavigate();
  const { data: marketplaceSellers = [] } = useMarketplaceData();
  const { data: rows = [] } = useQuery({
    queryKey: ['buyer-contact-threads', user?.id, marketplaceSellers.length],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      try {
      const { data, error } = await supabase
        .from('seller_conversations')
        .select('id, seller_id, last_message_at')
        .eq('buyer_id', user!.id)
        .order('last_message_at', { ascending: false })
        .limit(8);
      if (error || !data?.length) return [];
      return data.map((row) => ({
        id: row.id,
        sellerId: row.seller_id,
        name: sellerNames?.get(row.seller_id)
          || marketplaceSellers.find((seller) => seller.seller_id === row.seller_id)?.business_name
          || 'Seller',
      }));
      } catch {
        return [];
      }
    },
  });

  if (rows.length === 0) return null;

  return (
    <section className="mt-3">
      <h3 className="px-4 mb-2 font-extrabold text-[15px] tracking-tight text-foreground">Your conversations</h3>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 pb-1">
        {rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={() => navigate(`/seller/${row.sellerId}`)}
            className="shrink-0 max-w-[200px] rounded-2xl border border-border bg-card px-3 py-2.5 text-left"
          >
            <p className="text-sm font-semibold text-foreground truncate">{row.name}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Continue</p>
          </button>
        ))}
      </div>
    </section>
  );
}
