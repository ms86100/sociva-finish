// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Package } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  sellerId: string;
}

interface LowStockProduct {
  id: string;
  name: string;
  stock_quantity: number;
  low_stock_threshold: number;
  image_url: string | null;
}

export function LowStockAlerts({ sellerId }: Props) {
  const { data: products = [] } = useQuery({
    queryKey: ['low-stock-products', sellerId],
    queryFn: async () => {
      // Fetch products with stock tracking enabled, then filter client-side
      // against each product's own low_stock_threshold (default 5)
      const { data } = await supabase
        .from('products')
        .select('id, name, stock_quantity, low_stock_threshold, image_url')
        .eq('seller_id', sellerId)
        .eq('is_available', true)
        .not('stock_quantity', 'is', null)
        .lte('stock_quantity', 20) // fetch wider range, filter below
        .order('stock_quantity', { ascending: true })
        .limit(20);
      // Filter: only show products at or below their own threshold
      return ((data || []) as LowStockProduct[]).filter(
        p => p.stock_quantity <= (p.low_stock_threshold || 5)
      ).slice(0, 10);
    },
    enabled: !!sellerId,
    staleTime: 2 * 60 * 1000,
  });

  if (products.length === 0) return null;

  const outOfStock = products.filter(p => p.stock_quantity === 0);
  const lowStock = products.filter(p => p.stock_quantity > 0);

  return (
    <Card className="border-destructive/20">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={14} className="text-destructive" />
          <p className="text-xs font-semibold">Stock Alerts</p>
          <Badge variant="destructive" className="text-[10px] ml-auto">
            {products.length} item{products.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        <div className="space-y-1.5">
          {outOfStock.map(p => (
            <Link
              key={p.id}
              to={`/seller/products/${p.id}/edit`}
              className="flex items-center gap-2 text-sm p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              {p.image_url ? (
                <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />
              ) : (
                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                  <Package size={12} className="text-muted-foreground" />
                </div>
              )}
              <span className="truncate flex-1 text-xs">{p.name}</span>
              <Badge variant="destructive" className="text-[10px] shrink-0">
                Out of stock
              </Badge>
            </Link>
          ))}

          {lowStock.map(p => (
            <Link
              key={p.id}
              to={`/seller/products/${p.id}/edit`}
              className="flex items-center gap-2 text-sm p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              {p.image_url ? (
                <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />
              ) : (
                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                  <Package size={12} className="text-muted-foreground" />
                </div>
              )}
              <span className="truncate flex-1 text-xs">{p.name}</span>
              <Badge variant="outline" className="text-[10px] text-warning border-warning/30 shrink-0">
                {p.stock_quantity} left
              </Badge>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
