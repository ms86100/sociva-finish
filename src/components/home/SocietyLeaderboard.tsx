// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Star, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCurrency } from '@/hooks/useCurrency';
import { cn } from '@/lib/utils';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { jitteredStaleTime } from '@/lib/query-utils';
import { staggerContainer, cardEntrance, listItem } from '@/lib/motion-variants';
import { useCountUp } from '@/hooks/useCountUp';

interface TopSeller {
  id: string;
  business_name: string;
  profile_image_url: string | null;
  rating: number;
  completed_order_count: number;
}

interface TopProduct {
  product_id: string;
  product_name: string;
  image_url: string | null;
  order_count: number;
  seller_name: string;
  seller_id: string;
  price: number;
}

function hashToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function AnimatedCount({ value }: { value: number }) {
  const animated = useCountUp(value);
  return <>{animated}</>;
}

export function SocietyLeaderboard() {
  const { effectiveSocietyId } = useAuth();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const ml = useMarketplaceLabels();

  const { data, isLoading: loading } = useQuery({
    queryKey: ['society-leaderboard', effectiveSocietyId],
    queryFn: async () => {
      const [sellersRes, productsRes] = await Promise.all([
        supabase
          .from('seller_profiles')
          .select('id, business_name, profile_image_url, rating, completed_order_count')
          .eq('society_id', effectiveSocietyId!)
          .eq('verification_status', 'approved')
          .gt('completed_order_count', 0)
          .order('completed_order_count', { ascending: false })
          .limit(5),
        supabase.rpc('get_society_top_products', {
          _society_id: effectiveSocietyId!,
          _limit: 5,
        }),
      ]);

      const sellers = (sellersRes.data || []) as TopSeller[];
      let products: TopProduct[] = [];
      if (!productsRes.error) {
        products = (productsRes.data || []).map((p: any) => ({
          product_id: p.product_id,
          product_name: p.product_name,
          image_url: p.image_url,
          order_count: Number(p.order_count) || 0,
          seller_name: p.seller_name || '',
          seller_id: p.seller_id || '',
          price: p.price || 0,
        }));
      }
      return { sellers, products };
    },
    enabled: !!effectiveSocietyId,
    staleTime: jitteredStaleTime(10 * 60_000),
  });

  const topSellers = data?.sellers ?? [];
  const topProducts = data?.products ?? [];

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-7 w-52 rounded-lg" />
        <Skeleton className="h-28 w-full rounded-2xl" />
      </div>
    );
  }

  if (topSellers.length === 0 && topProducts.length === 0) return null;

  return (
    <div className="space-y-3 px-4">
      {/* Top Sellers */}
      {topSellers.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-xl bg-warning/15 flex items-center justify-center">
              <Trophy size={16} className="text-warning" />
            </div>
            <h3 className="section-header">{ml.label('label_section_leaderboard_sellers')}</h3>
          </div>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
          >
            {topSellers.map((s) => {
              const hue = hashToHue(s.id);
              return (
                <motion.div
                  key={s.id}
                  variants={listItem}
                  whileTap={{ scale: 0.96 }}
                  className="shrink-0 flex flex-col items-center gap-2 cursor-pointer w-[76px]"
                  onClick={() => navigate(`/seller/${s.id}`)}
                >
                  <div className="w-16 h-16 rounded-2xl overflow-hidden border-2 border-border shadow-sm">
                    {s.profile_image_url ? (
                      <img src={s.profile_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center font-bold text-white text-lg"
                        style={{ backgroundColor: `hsl(${hue}, 50%, 45%)` }}
                      >
                        {s.business_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] font-semibold text-foreground truncate text-center w-full leading-tight">
                    {s.business_name}
                  </p>
                  <div className="flex items-center gap-0.5 -mt-0.5">
                    <Star size={10} className="text-warning fill-warning" />
                    <span className="text-[10px] font-medium text-muted-foreground">{s.rating.toFixed(1)}</span>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      )}

      {/* Most Ordered Products */}
      {topProducts.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
              <ShoppingBag size={16} className="text-primary" />
            </div>
            <h3 className="section-header">{ml.label('label_section_leaderboard_products')}</h3>
          </div>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="show"
            className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
          >
            {topProducts.map((p) => (
              <motion.div
                key={p.product_id}
                variants={cardEntrance}
                whileTap={{ scale: 0.97 }}
                className="shrink-0 w-[150px] rounded-2xl bg-card border border-border overflow-hidden cursor-pointer hover:shadow-elevated transition-shadow shadow-card"
                onClick={() => navigate(`/seller/${p.seller_id}`)}
              >
                <div className="relative aspect-[4/3] bg-secondary">
                  {p.image_url ? (
                    <img src={p.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ShoppingBag size={22} className="text-muted-foreground/40" />
                    </div>
                  )}
                  <span className="absolute bottom-1.5 right-1.5 text-[9px] font-bold text-primary-foreground bg-primary/90 backdrop-blur-sm rounded-full px-2 py-0.5">
                    <AnimatedCount value={p.order_count} />× ordered
                  </span>
                </div>
                <div className="p-2.5">
                  <p className="text-[11px] font-semibold text-foreground truncate leading-tight">{p.product_name}</p>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{p.seller_name}</p>
                  <p className="text-[11px] font-bold text-primary mt-1">{formatPrice(p.price)}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      )}
    </div>
  );
}
