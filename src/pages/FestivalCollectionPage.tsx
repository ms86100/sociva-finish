// @ts-nocheck
import { useParams } from 'react-router-dom';
import { useSmartBack } from '@/hooks/useSmartBack';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveProducts } from '@/lib/bannerProductResolver';
import { toProductWithSeller } from '@/lib/festivalProductMapper';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { FestivalStringLights } from '@/components/home/FestivalStringLights';
import { Skeleton } from '@/components/ui/skeleton';
import { ProductListingCard, ProductWithSeller } from '@/components/product/ProductListingCard';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useMarketplaceConfig } from '@/hooks/useMarketplaceConfig';
import { useBadgeConfig } from '@/hooks/useBadgeConfig';
import {
  emptyState as emptyStateVariant,
} from '@/lib/motion-variants';
import { motion } from 'framer-motion';
import { useCallback, useMemo, useState, lazy, Suspense } from 'react';

const ProductDetailSheet = lazy(() =>
  import('@/components/product/ProductDetailSheet').then((m) => ({ default: m.ProductDetailSheet })),
);

export default function FestivalCollectionPage() {
  const { bannerId, sectionId } = useParams<{ bannerId: string; sectionId: string }>();
  const goBack = useSmartBack('/');
  const { user, effectiveSocietyId } = useAuth();
  const { configs: categoryConfigs } = useCategoryConfigs();
  const marketplaceConfig = useMarketplaceConfig();
  const { badges: badgeConfigs } = useBadgeConfig();
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const { data: banner } = useQuery({
    queryKey: ['festival-banner', bannerId],
    queryFn: async () => {
      const { data } = await supabase
        .from('featured_items').select('*').eq('id', bannerId!).single();
      return data;
    },
    enabled: !!bannerId,
    staleTime: 5 * 60_000,
  });

  const { data: section } = useQuery({
    queryKey: ['banner-section', sectionId],
    queryFn: async () => {
      const { data } = await supabase
        .from('banner_sections').select('*').eq('id', sectionId!).single();
      return data;
    },
    enabled: !!sectionId,
    staleTime: 5 * 60_000,
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['festival-collection-products', sectionId, effectiveSocietyId],
    queryFn: () => resolveProducts({
      sourceType: (section as any)?.product_source_type || 'category',
      sourceValue: (section as any)?.product_source_value,
      sectionId: sectionId!,
      fallbackMode: (banner as any)?.fallback_mode || 'hide',
      limit: 50,
      societyId: effectiveSocietyId || undefined,
      bannerId: bannerId || undefined,
    }),
    enabled: !!section,
    staleTime: 2 * 60_000,
  });

  const themeConfig = (banner as any)?.theme_config || {};
  const gradient = Array.isArray(themeConfig.gradient) ? themeConfig.gradient.filter(Boolean) : [];
  const bgColor = themeConfig.bg || gradient[0] || '#3b0a1e';
  const accentColor = themeConfig.accent || (gradient.length >= 1 ? gradient[gradient.length - 1] : '#f5d76e');

  const headerStyle = {
    background: gradient.length >= 2
      ? `linear-gradient(180deg, ${bgColor} 0%, ${gradient[0]} 70%, ${bgColor} 100%)`
      : bgColor,
    ['--festival-accent' as string]: accentColor,
  };

  const listingProducts = useMemo(() => products.map(toProductWithSeller), [products]);
  const available = listingProducts.filter(p => p.is_available && (p.stock_quantity ?? 1) > 0);
  const outOfStock = listingProducts.filter(p => !p.is_available || (p.stock_quantity ?? 1) <= 0);

  const handleProductTap = useCallback((product: ProductWithSeller) => {
    if (user && bannerId && sectionId) {
      supabase.from('banner_analytics').insert({
        banner_id: bannerId, section_id: sectionId,
        event_type: 'product_click', product_id: product.id, user_id: user.id,
      }).then(() => {});
    }
    const catConfig = categoryConfigs.find(c => c.category === product.category);
    setSelectedProduct({
      product_id: product.id,
      product_name: product.name,
      price: product.price,
      image_url: product.image_url,
      is_veg: product.is_veg,
      category: product.category,
      description: product.description,
      seller_id: product.seller_id,
      seller_name: product.seller_name || '',
      seller_rating: product.seller_rating || 0,
      seller_reviews: product.seller_reviews || 0,
      seller_verified: !!product.seller_verified,
      delivery_time_text: product.delivery_time_text || null,
      _catIcon: catConfig?.icon || '🛍️',
      _catName: catConfig?.displayName || product.category,
    });
    setDetailOpen(true);
  }, [user, bannerId, sectionId, categoryConfigs]);

  return (
    <div className="min-h-screen bg-background pb-20">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="relative overflow-hidden"
        style={headerStyle}
      >
        <FestivalStringLights />
        <div className="flex items-start gap-3 px-4 pt-10 pb-6">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => goBack({ fallback: '/' })}
            className="w-10 h-10 mt-0.5 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0"
          >
            <ArrowLeft size={18} className="text-white" />
          </motion.button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-white/65">
              {(banner as any)?.title || 'Festival'}
            </p>
            <h1
              className="font-serif text-[28px] leading-tight font-bold mt-0.5"
              style={{ color: accentColor }}
            >
              {(section as any)?.icon_emoji} {(section as any)?.title || 'Collection'}
            </h1>
            {(section as any)?.subtitle && (
              <p className="text-white/80 text-xs mt-1">{(section as any).subtitle}</p>
            )}
          </div>
          <span className="text-white/70 text-xs font-medium mt-2 shrink-0">
            {available.length} items
          </span>
        </div>
      </motion.div>

      <div className="px-4 py-4">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-56 rounded-2xl" />
            ))}
          </div>
        ) : available.length === 0 && outOfStock.length === 0 ? (
          <motion.div
            variants={emptyStateVariant}
            initial="hidden"
            animate="show"
            className="text-center py-16"
          >
            <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-muted">
              <ShoppingBag size={28} className="text-muted-foreground/40" />
            </div>
            <p className="text-sm font-semibold text-muted-foreground">No items available in your area</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Check back later — sellers are adding products.</p>
          </motion.div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {available.map(product => (
                <ProductListingCard
                  key={product.id}
                  product={product}
                  onTap={handleProductTap}
                  onNavigate={navigate}
                  categoryConfigs={categoryConfigs as any}
                  marketplaceConfig={marketplaceConfig}
                  badgeConfigs={badgeConfigs}
                />
              ))}
            </div>

            {outOfStock.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground font-semibold mt-6 mb-2 uppercase tracking-wider">
                  Out of Stock
                </p>
                <div className="grid grid-cols-2 gap-3 opacity-60">
                  {outOfStock.map(product => (
                    <ProductListingCard
                      key={product.id}
                      product={product}
                      onTap={handleProductTap}
                      onNavigate={navigate}
                      categoryConfigs={categoryConfigs as any}
                      marketplaceConfig={marketplaceConfig}
                      badgeConfigs={badgeConfigs}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {detailOpen && (
        <Suspense fallback={null}>
          <ProductDetailSheet
            product={selectedProduct}
            open={detailOpen}
            onOpenChange={setDetailOpen}
          />
        </Suspense>
      )}
    </div>
  );
}
