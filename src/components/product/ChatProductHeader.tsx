// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { MapPin, Store, Tag } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ChatProductHeaderProps {
  productId: string;
  sellerName: string;
}

export function ChatProductHeader({ productId, sellerName }: ChatProductHeaderProps) {
  const { formatPrice } = useCurrency();

  const { data: product } = useQuery({
    queryKey: ['chat-product-header', productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select(`
          id, name, price, mrp, discount_percentage, image_url,
          category, is_veg,
          seller:seller_profiles!products_seller_id_fkey(business_name, society_id, 
            society:societies!seller_profiles_society_id_fkey(name))
        `)
        .eq('id', productId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
  });

  if (!product) return null;

  const seller = product.seller as any;
  const societyName = seller?.society?.name;
  const hasDiscount = product.discount_percentage && product.discount_percentage > 0;

  return (
    <div className="flex gap-2.5 px-4 py-2 border-b bg-muted/40">
      {/* Product thumbnail */}
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.name}
          className="w-12 h-12 rounded-lg object-cover shrink-0 border border-border"
        />
      ) : (
        <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-border">
          <Tag size={18} className="text-muted-foreground" />
        </div>
      )}

      {/* Product info */}
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm truncate text-foreground">{product.name}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="font-bold text-sm text-foreground">{formatPrice(product.price)}</span>
          {hasDiscount && product.mrp && (
            <>
              <span className="text-xs text-muted-foreground line-through">{formatPrice(product.mrp)}</span>
              <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 font-semibold">
                {product.discount_percentage}% off
              </Badge>
            </>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground truncate">
          <Store size={11} className="shrink-0" />
          <span className="truncate">{sellerName}</span>
          {societyName && (
            <>
              <span>·</span>
              <MapPin size={11} className="shrink-0" />
              <span className="truncate">{societyName}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
