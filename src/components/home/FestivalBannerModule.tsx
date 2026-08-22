// @ts-nocheck
import { useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveBannerSections, ResolvedProduct } from '@/lib/bannerProductResolver';
import { toProductWithSeller } from '@/lib/festivalProductMapper';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import { Store } from 'lucide-react';
import { AnimatedCategoryIcon, isAnimatedIcon } from '@/components/icons/AnimatedCategoryIcons';
import { ProductCarousel } from '@/components/product/ProductCarousel';
import { GroupedSellerRow } from '@/components/home/GroupedSellerRow';
import { FestivalStringLights } from '@/components/home/FestivalStringLights';
import { ProductWithSeller } from '@/components/product/ProductListingCard';
import {
  staggerContainer, cardEntrance,
} from '@/lib/motion-variants';

interface BannerSection {
  id: string;
  title: string;
  subtitle: string | null;
  icon_emoji: string | null;
  icon_color: string | null;
  display_order: number;
  product_source_type: string;
  product_source_value: string | null;
}

interface FestivalBannerProps {
  banner: any;
  sections: BannerSection[];
  onProductTap?: (product: ProductWithSeller) => void;
  categoryConfigs?: any[];
}

const bannerEntrance = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1, y: 0,
    transition: { type: 'spring', stiffness: 260, damping: 24, staggerChildren: 0.08 },
  },
};

const textReveal = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};

export function FestivalBannerModule({ banner, sections, onProductTap, categoryConfigs = [] }: FestivalBannerProps) {
  const navigate = useNavigate();
  const { user, effectiveSocietyId } = useAuth();
  const impressionTracked = useRef(false);

  const themeConfig = banner.theme_config || {};
  const animConfig = banner.animation_config || {};
  const gradient = Array.isArray(themeConfig.gradient) ? themeConfig.gradient.filter(Boolean) : [];
  const bgColor = themeConfig.bg || gradient[0] || '#3b0a1e';
  const accentColor = themeConfig.accent || (gradient.length >= 1 ? gradient[gradient.length - 1] : '#f5d76e');
  const fallbackMode = banner.fallback_mode || 'hide';

  const canvasStyle = {
    background: gradient.length >= 2
      ? `linear-gradient(180deg, ${bgColor} 0%, ${gradient[0]} 42%, ${bgColor} 100%)`
      : bgColor,
    ['--festival-accent' as string]: accentColor,
  };

  const animClass = animConfig.type && animConfig.type !== 'none'
    ? `banner-anim-${animConfig.type} banner-intensity-${animConfig.intensity || 'subtle'}`
    : '';

  useEffect(() => {
    if (impressionTracked.current || !user) return;
    impressionTracked.current = true;
    supabase.from('banner_analytics').insert({
      banner_id: banner.id, event_type: 'impression', user_id: user.id,
    }).then(() => {});
  }, [banner.id, user]);

  const { data: sectionProductsMap } = useQuery({
    queryKey: ['banner-batch-products', banner.id, effectiveSocietyId],
    queryFn: () => resolveBannerSections({
      bannerId: banner.id,
      societyId: effectiveSocietyId || undefined,
      limitPerSection: 12,
    }),
    staleTime: 60_000,
  });

  const populatedSections = useMemo(() => {
    return sections.filter((section) => {
      const products = sectionProductsMap?.get(section.id) || [];
      if (products.length > 0) return true;
      return fallbackMode === 'popular';
    }).filter((section) => (sectionProductsMap?.get(section.id) || []).length > 0);
  }, [sections, sectionProductsMap, fallbackMode]);

  const allProducts = useMemo(() => {
    const seen = new Set<string>();
    const list: ResolvedProduct[] = [];
    for (const section of populatedSections) {
      for (const p of sectionProductsMap?.get(section.id) || []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        list.push(p);
      }
    }
    return list;
  }, [populatedSections, sectionProductsMap]);

  const listingProducts = useMemo(
    () => allProducts.map(toProductWithSeller),
    [allProducts],
  );

  const sellerCount = useMemo(
    () => new Set(allProducts.map((p) => p.seller_id).filter(Boolean)).size,
    [allProducts],
  );

  if (!sectionProductsMap || populatedSections.length === 0) {
    return null;
  }

  const handleSectionClick = (section: BannerSection) => {
    if (user) {
      supabase.from('banner_analytics').insert({
        banner_id: banner.id, section_id: section.id,
        event_type: 'section_click', user_id: user.id,
      }).then(() => {});
    }
    navigate(`/festival-collection/${banner.id}/${section.id}`);
  };

  const scrollToRail = (sectionId: string) => {
    document.getElementById(`festival-rail-${sectionId}`)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  };

  const offerCopy = banner.badge_text
    || (sellerCount > 0
      ? `From ${sellerCount} seller${sellerCount === 1 ? '' : 's'} in your society`
      : 'Products from sellers in your society');

  return (
    <motion.div
      variants={bannerEntrance}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.08 }}
      className={cn('overflow-hidden festival-banner-card rounded-none', animClass)}
      style={canvasStyle}
    >
      <div className="relative px-4 pt-2 pb-5 overflow-hidden">
        <div className="festival-orb festival-orb-1" />
        <div className="festival-orb festival-orb-2" />
        <div className="festival-orb festival-orb-3" />

        <FestivalStringLights />

        <motion.p
          variants={textReveal}
          className="relative z-10 mt-2 text-[10px] font-semibold tracking-[0.22em] uppercase text-white/70"
        >
          Celebrate in your community
        </motion.p>
        <motion.h2
          variants={textReveal}
          className="relative z-10 mt-1 font-serif text-[34px] leading-[1.05] font-bold [text-shadow:_0_2px_18px_rgba(0,0,0,0.35)]"
          style={{ color: accentColor }}
        >
          {banner.title || 'Festival Special'}
        </motion.h2>
        {banner.subtitle && (
          <motion.p
            variants={textReveal}
            className="relative z-10 text-sm mt-1.5 text-white/90 max-w-[92%] [text-shadow:_0_1px_6px_rgba(0,0,0,0.4)]"
          >
            {banner.subtitle}
          </motion.p>
        )}

        {populatedSections.length > 0 && (
          <div className="relative z-10 mt-4 flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {populatedSections.map((section) => (
              <button
                key={`chip-${section.id}`}
                type="button"
                onClick={() => scrollToRail(section.id)}
                className="shrink-0 flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/95"
              >
                {isAnimatedIcon(section.icon_emoji) ? (
                  <AnimatedCategoryIcon iconKey={section.icon_emoji!} size={14} color={accentColor} />
                ) : (
                  <span className="text-sm leading-none">{section.icon_emoji || '✨'}</span>
                )}
                {section.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {populatedSections.length > 0 && (
        <div className="px-4 pb-3">
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="grid grid-cols-2 gap-2.5"
          >
            {populatedSections.map((section) => (
              <CategoryPhotoCard
                key={section.id}
                section={section}
                products={sectionProductsMap?.get(section.id) || []}
                accentColor={accentColor}
                onClick={() => handleSectionClick(section)}
              />
            ))}
          </motion.div>
        </div>
      )}

      <div className="px-4 pb-4">
        <div
          className="festival-offer-strip rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
          style={{ background: '#f6e2b8', color: '#5a3410' }}
        >
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider opacity-70">Festival offer</p>
            <p className="text-sm font-extrabold truncate">{offerCopy}</p>
          </div>
          <span className="shrink-0 text-[11px] font-bold rounded-full px-2.5 py-1 bg-[#5a3410]/10">
            Local sellers
          </span>
        </div>
      </div>

      {populatedSections.map((section) => {
        const products = (sectionProductsMap?.get(section.id) || []).map(toProductWithSeller);
        if (products.length === 0) return null;
        return (
          <div key={`rail-${section.id}`} id={`festival-rail-${section.id}`} className="pt-2 pb-4 scroll-mt-28">
            <ProductCarousel
              title={section.title}
              emoji={isAnimatedIcon(section.icon_emoji) ? undefined : (section.icon_emoji || undefined)}
              itemCount={products.length}
              products={products}
              onSeeAll={() => handleSectionClick(section)}
              onProductTap={onProductTap}
              tone="festival"
              accentColor={accentColor}
            />
          </div>
        );
      })}

      {listingProducts.length > 0 && (
        <div className="pt-1 pb-6">
          <GroupedSellerRow
            title="From sellers in your community"
            icon={<Store size={15} style={{ color: accentColor }} />}
            products={listingProducts}
            onProductTap={onProductTap}
            categoryConfigs={categoryConfigs}
            maxSellers={8}
            maxProductsPerSeller={2}
            tone="festival"
            accentColor={accentColor}
          />
        </div>
      )}
    </motion.div>
  );
}

function CategoryPhotoCard({
  section, products, accentColor, onClick,
}: {
  section: BannerSection;
  products: ResolvedProduct[];
  accentColor: string;
  onClick: () => void;
}) {
  const previews = products.filter((p) => p.image_url).slice(0, 4);
  const chipColor = section.icon_color || accentColor;

  return (
    <motion.button
      variants={cardEntrance}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="festival-merch-card text-left w-full"
      style={{ ['--festival-accent' as string]: accentColor }}
    >
      <span className="festival-corner-bl" />
      <span className="festival-corner-br" />
      <p className="px-3 pt-3 pb-1.5 text-[12px] font-extrabold text-neutral-900 leading-tight line-clamp-1">
        {section.title}
      </p>
      <div className="px-1.5 pb-1.5">
        {previews.length >= 4 ? (
          <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden aspect-[1/1.05] bg-neutral-100">
            {previews.slice(0, 4).map((p) => (
              <img
                key={p.id}
                src={optimizedImageUrl(p.image_url || '', { width: 160, quality: 70 })}
                alt=""
                className="w-full h-full object-cover aspect-square"
                onError={handleImageError}
              />
            ))}
          </div>
        ) : previews.length > 0 ? (
          <div className="rounded-xl overflow-hidden aspect-[1/1.05] bg-neutral-100">
            <img
              src={optimizedImageUrl(previews[0].image_url || '', { width: 280, quality: 75 })}
              alt=""
              className="w-full h-full object-cover"
              onError={handleImageError}
            />
          </div>
        ) : (
          <div
            className="rounded-xl aspect-[1/1.05] flex items-center justify-center"
            style={{ background: `${chipColor}18` }}
          >
            {isAnimatedIcon(section.icon_emoji) ? (
              <AnimatedCategoryIcon iconKey={section.icon_emoji!} size={44} color={chipColor} />
            ) : (
              <span className="text-4xl">{section.icon_emoji || '📦'}</span>
            )}
          </div>
        )}
      </div>
    </motion.button>
  );
}
