// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';

interface Props {
  productId: string;
}

interface Stability {
  days_stable: number;
  price_change: number;
  direction: string;
}

export function PriceStabilityBadge({ productId }: Props) {
  const [stability, setStability] = useState<Stability | null>(null);

  useEffect(() => {
    supabase.rpc('get_price_stability', { _product_id: productId }).then(({ data, error }) => {
      if (error) {
        console.warn('[PriceStability] RPC error:', error.message);
        return;
      }
      if (data && data.length > 0) setStability(data[0] as any);
    });
  }, [productId]);

  if (!stability || stability.days_stable < 7) return null;

  const icon = stability.direction === 'down'
    ? <TrendingDown size={10} className="text-success" />
    : stability.direction === 'up'
    ? <TrendingUp size={10} className="text-destructive" />
    : <Minus size={10} className="text-muted-foreground" />;

  const label = stability.direction === 'stable' || stability.price_change === 0
    ? `Price stable for ${stability.days_stable} days`
    : stability.direction === 'down'
    ? `↓ ₹${stability.price_change} cheaper since last change`
    : `Price changed ${stability.days_stable} days ago`;

  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}
