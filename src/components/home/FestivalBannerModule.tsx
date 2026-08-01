// @ts-nocheck
import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveBannerSections, ResolvedProduct } from '@/lib/bannerProductResolver';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag } from 'lucide-react';
import { AnimatedCategoryIcon, isAnimatedIcon } from '@/components/icons/AnimatedCategoryIcons';
import {
  staggerContainer, staggerContainerSlow, cardEntrance, glassFadeIn,
  fadeSlideUp, scalePress, badgePop, scaleIn, easings, durations,
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
}

const bannerEntrance = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  show: {
    opacity: 1, y: 0, scale: 1,
    transition: { type: 'spring', stiffness: 260, damping: 24, staggerChildren: 0.1 },
  },
};

const textReveal = {
  hidden: { opacity: 0, y: 12, filter: 'blur(4px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

const peekPop = {
  hidden: { opacity: 0, scale: 0, rotate: -15 },
  show: { opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 300, damping: 12 } },
};

const chipEntrance = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 260, damping: 24 } },
};


export function FestivalBannerModule({ banner, sections }: FestivalBannerProps) {
  const navigate = useNavigate();
  const { user, effectiveSocietyId } = useAuth();
  const impressionTracked = useRef(false);

  const themeConfig = banner.theme_config || {};
  const animConfig = banner.animation_config || {};
  const gradient = themeConfig.gradient || [];
  const bgColor = themeConfig.bg || 'hsl(var(--primary))';
  const accentColor = gradient.length >= 1 ? gradient[gradient.length - 1] : bgColor;

  // Always use white text with strong shadow for readability on any gradient
  const bannerTextClass = 'text-white [text-shadow:_0_1px_8px_rgba(0,0,0,0.5)]';
  const bannerSubtextClass = 'text-white/90 [text-shadow:_0_1px_6px_rgba(0,0,0,0.4)]';

  const gradientStyle = gradient.length >= 2
    ? { background: `linear-gradient(135deg, ${gradient.join(', ')})` }
    : { backgroundColor: bgColor };

  const chipsContainerStyle = gradient.length >= 1
    ? { background: `linear-gradient(to bottom, ${accentColor}12, transparent 80%)` }
    : {};

  const animClass = animConfig.type && animConfig.type !== 'none'
    ? `banner-anim-${animConfig.type} banner-intensity-${animConfig.intensity || 'subtle'}`
    : '';

  // Track impression once
  useEffect(() => {
    if (impressionTracked.current || !user) return;
    impressionTracked.current = true;
    supabase.from('banner_analytics').insert({
      banner_id: banner.id, event_type: 'impression', user_id: user.id,
    }).then(() => {});
  }, [banner.id, user]);

  // Batch-fetch ALL sections' products in a single RPC call
  const { data: sectionProductsMap } = useQuery({
    queryKey: ['banner-batch-products', banner.id, effectiveSocietyId],
    queryFn: () => resolveBannerSections({
      bannerId: banner.id,
      societyId: effectiveSocietyId || undefined,
      limitPerSection: 20,
    }),
    staleTime: 60_000,
  });

  // Extract peek products from first section
  const firstSection = sections[0];
  const peekProducts = useMemo(() => {
    if (!sectionProductsMap || !firstSection) return [];
    return (sectionProductsMap.get(firstSection.id) || []).slice(0, 4);
  }, [sectionProductsMap, firstSection]);

  const handleSectionClick = (section: BannerSection) => {
    if (user) {
      supabase.from('banner_analytics').insert({
        banner_id: banner.id, section_id: section.id,
        event_type: 'section_click', user_id: user.id,
      }).then(() => {});
    }
    navigate(`/festival-collection/${banner.id}/${section.id}`);
  };

  return (
    <motion.div
      variants={bannerEntrance}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.15 }}
      className="mx-4 my-3 rounded-3xl overflow-hidden festival-banner-card"
    >
      {/* ── Themed Header with floating particles ── */}
      <div
        className={cn('relative px-5 pt-5 pb-7 overflow-hidden', animClass)}
        style={gradientStyle}
      >
        {/* Dark gradient overlay for guaranteed text contrast on any background */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/20 to-transparent pointer-events-none z-[1]" />

        <div className="festival-orb festival-orb-1" />
        <div className="festival-orb festival-orb-2" />
        <div className="festival-orb festival-orb-3" />

        {banner.badge_text && (
          <motion.span
            variants={badgePop}
            className="absolute top-3 right-3 text-white text-[10px] font-bold px-3 py-1 rounded-full border border-white/25 backdrop-blur-md z-10 [text-shadow:_0_1px_4px_rgba(0,0,0,0.4)]"
            style={{ backgroundColor: `${accentColor}40` }}
          >
            {banner.badge_text}
          </motion.span>
        )}

        <motion.h2
          variants={textReveal}
          className={cn("font-extrabold text-xl leading-tight drop-shadow-md relative z-10", bannerTextClass)}
        >
          {banner.title || 'Festival Special'}
        </motion.h2>
        {banner.subtitle && (
          <motion.p
            variants={textReveal}
            className={cn("text-sm mt-1.5 max-w-[75%] relative z-10", bannerSubtextClass)}
          >
            {banner.subtitle}
          </motion.p>
        )}

        {peekProducts.length > 0 && (
          <motion.div
            variants={staggerContainer}
            className="flex items-center gap-2.5 mt-4 relative z-10"
          >
            {peekProducts.map((p) => (
              <motion.div
                key={p.id}
                variants={peekPop}
                className="w-11 h-11 rounded-full overflow-hidden border-2 border-white/50 shadow-lg"
              >
                <img
                  src={optimizedImageUrl(p.image_url || '', { width: 88, quality: 65 })}
                  alt="" className="w-full h-full object-cover"
                  onError={handleImageError}
                />
              </motion.div>
            ))}
            <motion.span
              variants={textReveal}
              className="text-white/80 text-xs font-semibold ml-0.5 tracking-wide [text-shadow:_0_1px_4px_rgba(0,0,0,0.3)]"
            >
              & more →
            </motion.span>
          </motion.div>
        )}
      </div>

      {/* ── Section Chips with gradient bleed ── */}
      <div className="px-4 py-4 rounded-b-3xl" style={chipsContainerStyle}>
        <motion.div
          variants={staggerContainerSlow}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="flex gap-3 overflow-x-auto scrollbar-hide pb-1"
        >
          {sections.map((section) => (
            <SectionChip
              key={section.id}
              section={section}
              products={sectionProductsMap?.get(section.id) || []}
              accentColor={accentColor}
              onClick={() => handleSectionClick(section)}
            />
          ))}
        </motion.div>
      </div>
    </motion.div>
  );
}

function SectionChip({
  section, products, accentColor, onClick,
}: {
  section: BannerSection; products: ResolvedProduct[];
  accentColor: string; onClick: () => void;
}) {
  const displayPreviews = products.slice(0, 3);
  const chipColor = section.icon_color || accentColor;

  return (
    <motion.button
      variants={chipEntrance}
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className={cn(
        'shrink-0 w-[9.5rem] rounded-2xl border border-white/[0.06] p-3.5 flex flex-col items-center gap-2',
        'festival-chip transition-shadow duration-300',
      )}
      style={{
        background: `linear-gradient(160deg, ${chipColor}0d, ${chipColor}05)`,
      }}
    >
      {isAnimatedIcon(section.icon_emoji) ? (
        <AnimatedCategoryIcon iconKey={section.icon_emoji!} size={36} color={chipColor} />
      ) : (
        <span className="text-3xl festival-emoji-float">
          {section.icon_emoji || '📦'}
        </span>
      )}

      <p className="text-xs font-bold text-foreground text-center leading-tight line-clamp-2">
        {section.title}
      </p>

      {displayPreviews.length > 0 && (
        <div className="flex items-center -space-x-2 mt-0.5">
          {displayPreviews.map((p, i) => (
            <img
              key={p.id}
              src={optimizedImageUrl(p.image_url || '', { width: 80, quality: 60 })}
              alt=""
              className="w-8 h-8 rounded-full object-cover border-2 border-background shadow-sm"
              style={{ zIndex: 3 - i }}
              onError={handleImageError}
            />
          ))}
        </div>
      )}

      <span
        className="text-[10px] font-bold px-3 py-[3px] rounded-full tracking-wide"
        style={{ backgroundColor: `${chipColor}1a`, color: chipColor }}
      >
        {products.length === 0 ? 'Coming soon' : `${products.length} item${products.length !== 1 ? 's' : ''} →`}
      </span>
    </motion.button>
  );
}
