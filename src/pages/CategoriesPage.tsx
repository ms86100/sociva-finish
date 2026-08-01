// @ts-nocheck
import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { useNearbySocietySellers } from '@/hooks/queries/useStoreDiscovery';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import { Skeleton } from '@/components/ui/skeleton';
import { motion } from 'framer-motion';
import { Store, Sparkles, Clock, Star, Users, Tag } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { cn } from '@/lib/utils';
import { useSearchPlaceholder } from '@/hooks/useSearchPlaceholder';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { getCategoryPastel } from '@/lib/category-pastels';

/* ── Helpers ─────────────────────────────────────────────── */

interface CategoryMeta {
  count: number;
  sellerCount: number;
  minPrice: number | null;
  collageImages: string[];
  hasBestseller: boolean;
}

function buildCategoryMeta(
  productCategories: { category: string; products: any[] }[],
): Record<string, CategoryMeta> {
  const map: Record<string, CategoryMeta> = {};
  for (const pc of productCategories) {
    const products = pc.products ?? [];
    const sellers = new Set<string>();
    const images: string[] = [];
    let min: number | null = null;
    let bestseller = false;

    for (const p of products) {
      if (p.seller_id) sellers.add(p.seller_id);
      if (p.image_url && images.length < 4 && !images.includes(p.image_url)) {
        images.push(p.image_url);
      }
      const price = typeof p.price === 'number' ? p.price : parseFloat(p.price);
      if (!isNaN(price) && (min === null || price < min)) min = price;
      if (p.is_bestseller) bestseller = true;
    }

    map[pc.category] = {
      count: products.length,
      sellerCount: sellers.size,
      minPrice: min,
      collageImages: images,
      hasBestseller: bestseller,
    };
  }
  return map;
}

/* ── Collage component ──────────────────────────── */

function ImageCollage({ images, fallbackIcon, fallbackUrl, alt, color }: {
  images: string[];
  fallbackIcon: string;
  fallbackUrl?: string | null;
  alt: string;
  color?: string | null;
}) {
  if (images.length === 0 && fallbackUrl) {
    return (
      <img src={fallbackUrl} alt={alt} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
    );
  }
  if (images.length === 0) {
    return (
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ backgroundColor: color ? `${color}20` : 'hsl(var(--secondary))' }}
      >
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ backgroundColor: color ? `${color}30` : undefined }}
        >
          <DynamicIcon name={fallbackIcon} size={28} className="text-foreground/60" style={color ? { color } : undefined} />
        </div>
      </div>
    );
  }

  const itemClass = `items-${Math.min(images.length, 4)}`;

  return (
    <div className={cn('category-collage absolute inset-0', itemClass)}>
      {images.slice(0, 4).map((src, i) => (
        <img
          key={i}
          src={src}
          alt={`${alt} ${i + 1}`}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ))}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────── */

export default function CategoriesPage() {
  const { profile, isLoading: authLoading } = useAuth();
  const { configs, isLoading: configsLoading } = useCategoryConfigs();
  const { groups, isLoading: groupsLoading } = useParentGroups();
  const { data: productCategories = [], isLoading: productsLoading } = useProductsByCategory();
  const { formatPrice } = useCurrency();
  const ml = useMarketplaceLabels();

  const browseBeyond = profile?.browse_beyond_community ?? true;
  const searchRadius = profile?.search_radius_km ?? 10;
  const { data: nearbyBands = [], isLoading: nearbyLoading } = useNearbySocietySellers(searchRadius, browseBeyond);

  const searchQuery = '';
  const [activeGroup, setActiveGroup] = useState<string>('all');
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const metaMap = useMemo(() => buildCategoryMeta(productCategories), [productCategories]);

  const activeCategorySet = (() => {
    const s = new Set(productCategories.map(c => c.category));
    if (browseBeyond && nearbyBands.length > 0) {
      for (const band of nearbyBands) {
        for (const society of band.societies) {
          for (const group of Object.keys(society.sellersByGroup)) {
            for (const seller of society.sellersByGroup[group]) {
              if (seller.categories) {
                seller.categories.forEach((cat: string) => s.add(cat));
              }
            }
          }
        }
      }
    }
    return s;
  })();

  const isLoading = authLoading || configsLoading || groupsLoading || productsLoading || (browseBeyond && nearbyLoading);

  const grouped = (() => {
    const q = searchQuery.toLowerCase().trim();
    return groups
      .filter(g => g.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(group => ({
        ...group,
        categories: configs
          .filter(c =>
            c.parentGroup === group.slug &&
            c.isActive &&
            activeCategorySet.has(c.category) &&
            (!q || c.displayName.toLowerCase().includes(q))
          )
          .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99)),
      }))
      .filter(g => g.categories.length > 0);
  })();

  const filteredGroups = activeGroup === 'all'
    ? grouped
    : grouped.filter(g => g.slug === activeGroup);

  const isEmpty = !isLoading && grouped.length === 0;

  const handlePillClick = (slug: string) => {
    setActiveGroup(slug);
    if (slug !== 'all' && sectionRefs.current[slug]) {
      sectionRefs.current[slug]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const activeParentGroups = useMemo(() => {
    const slugs = new Set(grouped.map(g => g.slug));
    return groups.filter(g => g.is_active && slugs.has(g.slug)).sort((a, b) => a.sort_order - b.sort_order);
  }, [groups, grouped]);

  const searchPlaceholder = useSearchPlaceholder();

  return (
    <AppLayout showHeader={false}>
      {/* Header */}
      <SafeHeader zIndex="z-40" blur bordered={false}>
        <div className="px-4 pt-3 pb-1">
          <h1 className="text-lg font-bold text-foreground">{ml.label('label_categories_page_title')}</h1>
          <p className="text-xs text-muted-foreground mb-1">{ml.label('label_categories_page_subtitle')}</p>
          <div className="h-[2px] rounded-full bg-gradient-to-r from-primary via-primary/50 to-transparent" />
        </div>

        <div className="px-3 pb-2">
          <Link to="/search" className="block">
            <div className="flex items-center gap-2.5 bg-secondary rounded-2xl px-4 py-3">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground shrink-0">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.3-4.3"/>
              </svg>
              <span className="text-sm text-muted-foreground flex-1 transition-opacity duration-300">{searchPlaceholder}</span>
            </div>
          </Link>
        </div>
      </SafeHeader>

      {/* Parent Group Pills */}
      {!isLoading && activeParentGroups.length > 0 && (
        <div className="flex gap-1.5 px-4 pb-2 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          <button
            onClick={() => handlePillClick('all')}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all border snap-start min-w-[auto]',
              activeGroup === 'all'
                ? 'bg-primary text-primary-foreground border-primary scale-105'
                : 'bg-card text-muted-foreground border-border active:scale-[0.97]'
            )}
          >
            All
          </button>
          {activeParentGroups.map(g => (
            <button
              key={g.slug}
              onClick={() => handlePillClick(g.slug)}
              className={cn(
                'px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all border snap-start min-w-[auto] flex items-center gap-1',
                activeGroup === g.slug
                  ? 'bg-primary text-primary-foreground border-primary scale-105'
                  : 'bg-card text-muted-foreground border-border active:scale-[0.97]'
              )}
            >
              <DynamicIcon name={g.icon || 'Package'} size={12} />
              {g.name}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="px-3 pb-24">
        {isLoading ? (
          <div className="space-y-5">
            {[1, 2].map(i => (
              <div key={i}>
                <Skeleton className="h-4 w-28 mb-2 rounded-full" />
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[1, 2, 3, 4].map(j => (
                    <Skeleton key={j} className="aspect-[3/2] rounded-2xl" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="relative mb-6"
            >
              <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center">
                <Store size={40} className="text-primary" />
              </div>
              <motion.div
                animate={{ y: [0, -6, 0] }}
                transition={{ repeat: 0, duration: 2, ease: 'easeInOut' }}
                className="absolute -top-2 -right-2"
              >
                <div className="w-8 h-8 rounded-full bg-warning/20 flex items-center justify-center">
                  <Sparkles size={16} className="text-warning" />
                </div>
              </motion.div>
            </motion.div>
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
              className="space-y-3"
            >
              <h2 className="text-lg font-bold text-foreground">{ml.label('label_empty_categories_title')}</h2>
              <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                {ml.label('label_empty_categories_desc')}
              </p>
            </motion.div>
            <motion.div
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
              className="mt-6 flex items-center gap-2 text-xs text-muted-foreground bg-muted rounded-full px-4 py-2"
            >
              <Clock size={14} />
              <span>{ml.label('label_empty_categories_hint')}</span>
            </motion.div>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredGroups.map((group, groupIdx) => (
              <motion.div
                key={group.slug}
                ref={el => { sectionRefs.current[group.slug] = el; }}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: groupIdx * 0.08, duration: 0.35 }}
              >
                {/* Section Header */}
                <div className="flex items-center gap-2 mb-3 px-1">
                  <span
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold"
                    style={{
                      backgroundColor: group.color ? `${group.color}15` : 'hsl(var(--primary) / 0.1)',
                      color: group.color || 'hsl(var(--primary))',
                    }}
                  >
                    <DynamicIcon name={group.icon || 'Package'} size={13} /> {group.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground">({group.categories.length})</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {/* Category Cards Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {group.categories.map((cat, catIdx) => {
                    const meta = metaMap[cat.category] || { count: 0, sellerCount: 0, minPrice: null, collageImages: [], hasBestseller: false };
                    const pastelColor = getCategoryPastel(cat.category, cat.color);
                    const images = meta.collageImages.length > 0
                      ? meta.collageImages
                      : cat.imageUrl ? [cat.imageUrl] : [];
                    return (
                      <motion.div
                        key={cat.category}
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: groupIdx * 0.08 + catIdx * 0.04, duration: 0.3 }}
                      >
                        <Link
                          to={`/category/${cat.parentGroup}?sub=${cat.category}`}
                          className="block rounded-2xl overflow-hidden shadow-sm active:scale-[0.97] transition-all duration-200 group"
                          style={{ backgroundColor: pastelColor }}
                        >
                          {/* Image area */}
                          <div className="relative p-3">
                            <div className="flex gap-1.5 h-24">
                              {images.length >= 2 ? (
                                images.slice(0, 2).map((src, i) => (
                                  <div key={i} className="flex-1 h-full rounded-xl overflow-hidden bg-white/40">
                                    <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
                                  </div>
                                ))
                              ) : images.length === 1 ? (
                                <div className="flex-1 h-full rounded-xl overflow-hidden bg-white/40">
                                  <img src={images[0]} alt={cat.displayName} className="w-full h-full object-cover" loading="lazy" />
                                </div>
                              ) : (
                                <div className="flex-1 h-full flex items-center justify-center rounded-xl bg-white/40">
                                  <DynamicIcon name={cat.icon} size={36} className="text-gray-400" />
                                </div>
                              )}
                            </div>

                            {meta.count > 0 && (
                              <div className="absolute bottom-4 right-4 bg-black/60 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                                +{meta.count} items
                              </div>
                            )}

                            {meta.hasBestseller && (
                              <div className="absolute top-4 left-4 w-6 h-6 rounded-full bg-amber-400 flex items-center justify-center shadow-sm">
                                <Star size={12} className="text-white fill-white" />
                              </div>
                            )}
                          </div>

                          {/* Info section */}
                          <div className="px-3 pb-3">
                            <span className="text-[13px] font-semibold text-gray-900 leading-tight line-clamp-2">
                              {cat.displayName}
                            </span>
                            <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-600">
                              {meta.sellerCount > 0 && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Users size={10} className="shrink-0" />
                                  {meta.sellerCount} {meta.sellerCount === 1 ? ml.label('label_seller_count_singular') : ml.label('label_seller_count_plural')}
                                </span>
                              )}
                              {meta.minPrice !== null && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Tag size={10} className="shrink-0" />
                                  From {formatPrice(meta.minPrice)}
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      </motion.div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
