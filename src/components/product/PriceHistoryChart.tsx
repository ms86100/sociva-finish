// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Shield } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

interface PriceHistoryChartProps {
  productId: string;
  priceStableSince?: string | null;
}

export function PriceHistoryChart({ productId, priceStableSince }: PriceHistoryChartProps) {
  const { formatPrice } = useCurrency();
  const ml = useMarketplaceLabels();
  const maxPoints = ml.threshold('price_history_max_points');
  const stableDays = ml.threshold('stable_price_days');

  const { data: history } = useQuery({
    queryKey: ['price-history', productId],
    queryFn: async () => {
      const { data } = await supabase
        .from('price_history')
        .select('old_price, new_price, changed_at')
        .eq('product_id', productId)
        .order('changed_at', { ascending: true })
        .limit(maxPoints || 30);
      return data || [];
    },
    enabled: !!productId,
    staleTime: 5 * 60 * 1000,
  });

  const isStable = priceStableSince
    ? (Date.now() - new Date(priceStableSince).getTime()) > (stableDays || 30) * 24 * 60 * 60 * 1000
    : false;

  const stableLabel = ml.label('label_stable_price');

  if (!history || history.length === 0) {
    if (isStable) {
      return (
        <Badge variant="secondary" className="text-[10px] bg-success/10 text-success gap-1">
          <Shield size={10} /> {stableLabel}
        </Badge>
      );
    }
    return null;
  }

  const prices = [
    Number(history[0].old_price),
    ...history.map((h) => Number(h.new_price)),
  ].filter((n) => Number.isFinite(n));

  if (prices.length === 0) return null;

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <div className="space-y-1">
      {isStable && (
        <Badge variant="secondary" className="text-[10px] bg-success/10 text-success gap-1">
          <Shield size={10} /> {stableLabel}
        </Badge>
      )}
      <p className="text-xs text-muted-foreground">
        Price range{' '}
        <span className="font-semibold text-foreground tabular-nums">
          {formatPrice(minPrice)} – {formatPrice(maxPrice)}
        </span>
      </p>
    </div>
  );
}
