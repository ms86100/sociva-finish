// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ResponsiveContainer, LineChart, Line, YAxis } from 'recharts';
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

  // Build chart data points
  const chartData = history.map((h) => ({
    price: Number(h.new_price),
    date: h.changed_at,
  }));

  // Add the first old_price as the starting point
  if (history.length > 0) {
    chartData.unshift({
      price: Number(history[0].old_price),
      date: history[0].changed_at,
    });
  }

  const prices = chartData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <div className="space-y-1">
      {isStable && (
        <Badge variant="secondary" className="text-[10px] bg-success/10 text-success gap-1">
          <Shield size={10} /> {stableLabel}
        </Badge>
      )}
      <div className="h-12 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <YAxis domain={[minPrice * 0.95, maxPrice * 1.05]} hide />
            <Line
              type="monotone"
              dataKey="price"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>Low: {formatPrice(minPrice)}</span>
        <span>High: {formatPrice(maxPrice)}</span>
      </div>
    </div>
  );
}
