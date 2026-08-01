// @ts-nocheck
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import { Star, Flame, Tag, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

interface HighlightCard {
  id: string;
  type: 'bestseller' | 'top_seller' | 'deal';
  title: string;
  subtitle: string;
  imageUrl: string | null;
  navigateTo: string;
  accentColor: string;
  icon: React.ReactNode;
}

export function AutoHighlightStrip() {
  const { effectiveSocietyId } = useAuth();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const ml = useMarketplaceLabels();

  const { data: highlights = [], isLoading } = useQuery({
    queryKey: ['auto-highlights', effectiveSocietyId],
    queryFn: async (): Promise<HighlightCard[]> => {
      if (!effectiveSocietyId) return [];

      const [bestsellersRes, topSellersRes, couponsRes] = await Promise.all([
        supabase
          .from('products')
          .select('id, name, image_url, price, seller_id, seller_profiles!inner(society_id)')
          .eq('is_bestseller', true)
          .eq('is_available', true)
          .eq('seller_profiles.society_id', effectiveSocietyId)
          .limit(3),
        supabase
          .from('seller_profiles')
          .select('id, business_name, profile_image_url, rating, completed_order_count')
          .eq('society_id', effectiveSocietyId)
          .eq('verification_status', 'approved')
          .gt('rating', 0)
          .order('rating', { ascending: false })
          .limit(3),
        supabase
          .from('coupons')
          .select('id, code, description, discount_type, discount_value, min_order_amount, max_discount_amount, expires_at, seller_id, seller_profiles!inner(business_name, profile_image_url)')
          .eq('is_active', true)
          .eq('show_to_buyers', true)
          .or(`society_id.eq.${effectiveSocietyId},society_id.is.null`)
          .limit(3),
      ]);

      const cards: HighlightCard[] = [];

      for (const p of (bestsellersRes.data || []) as any[]) {
        cards.push({
          id: `bs-${p.id}`,
          type: 'bestseller',
          title: p.name,
          subtitle: formatPrice(p.price),
          imageUrl: p.image_url,
          navigateTo: `/seller/${p.seller_id}`,
          accentColor: 'hsl(var(--destructive))',
          icon: <Flame size={12} className="text-destructive" />,
        });
      }

      for (const s of (topSellersRes.data || []) as any[]) {
        cards.push({
          id: `ts-${s.id}`,
          type: 'top_seller',
          title: s.business_name,
          subtitle: `⭐ ${s.rating.toFixed(1)} · ${s.completed_order_count} orders`,
          imageUrl: s.profile_image_url,
          navigateTo: `/seller/${s.id}`,
          accentColor: 'hsl(var(--primary))',
          icon: <Star size={12} className="text-primary" />,
        });
      }

      for (const c of (couponsRes.data || []) as any[]) {
        const discountText = c.discount_type === 'percentage'
          ? `${c.discount_value}% OFF`
          : `${formatPrice(c.discount_value)} OFF`;
        const sellerName = c.seller_profiles?.business_name || '';
        const details: string[] = [];
        if (c.description) details.push(c.description);
        else details.push(`Code: ${c.code}`);
        if (c.min_order_amount) details.push(`Min ${formatPrice(c.min_order_amount)}`);
        if (c.max_discount_amount && c.discount_type === 'percentage') details.push(`Up to ${formatPrice(c.max_discount_amount)}`);
        if (sellerName) details.push(`@ ${sellerName}`);
        cards.push({
          id: `deal-${c.id}`,
          type: 'deal',
          title: discountText,
          subtitle: details.join(' · '),
          imageUrl: c.seller_profiles?.profile_image_url || null,
          navigateTo: `/seller/${c.seller_id}`,
          accentColor: 'hsl(var(--warning))',
          icon: <Tag size={12} className="text-warning" />,
        });
      }

      return cards.slice(0, 8);
    },
    staleTime: 5 * 60_000,
    enabled: !!effectiveSocietyId,
  });

  if (!effectiveSocietyId || isLoading || highlights.length === 0) return null;

  return (
    <div className="my-4">
      <div className="flex items-center gap-1.5 px-4 mb-2.5">
        <TrendingUp size={13} className="text-primary" />
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">{ml.label('label_section_highlights')}</span>
      </div>
      {/* Gap #17: Reduced card width from 180px to 140px, image from h-20 to h-14 */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide px-4 pb-1 snap-x snap-mandatory">
        {highlights.map((card, i) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            onClick={() => navigate(card.navigateTo)}
            className={cn(
              'shrink-0 w-[140px] rounded-2xl overflow-hidden cursor-pointer snap-start',
              'border border-border bg-card',
              'transition-all duration-200 hover:shadow-md active:scale-[0.97]',
            )}
          >
            <div className="relative h-14 overflow-hidden">
              {card.imageUrl ? (
                <img src={card.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center"
                  style={{ backgroundColor: `color-mix(in srgb, ${card.accentColor} 15%, hsl(var(--card)))` }}
                >
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `color-mix(in srgb, ${card.accentColor} 25%, hsl(var(--card)))` }}
                  >
                    {card.type === 'deal' && <Tag size={16} className="text-warning" />}
                    {card.type === 'bestseller' && <Flame size={16} className="text-destructive" />}
                    {card.type === 'top_seller' && <Star size={16} className="text-primary" />}
                  </div>
                </div>
              )}
              <div className="absolute top-1 left-1 flex items-center gap-0.5 bg-background/80 backdrop-blur-sm rounded-full px-1.5 py-0.5">
                {card.icon}
                <span className="text-[7px] font-bold text-foreground uppercase tracking-wide">
                  {card.type === 'bestseller' ? ml.label('label_highlight_bestseller') : card.type === 'top_seller' ? ml.label('label_highlight_top_rated') : ml.label('label_highlight_deal')}
                </span>
              </div>
            </div>
            <div className="p-2">
              <p className="text-[11px] font-bold text-foreground line-clamp-1 leading-tight">{card.title}</p>
              <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">{card.subtitle}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
