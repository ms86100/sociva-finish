// @ts-nocheck
import { memo, useMemo } from 'react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { Link } from 'react-router-dom';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { Skeleton } from '@/components/ui/skeleton';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { ChevronRight, Sparkles, ArrowRight } from 'lucide-react';
import { getCategoryPastel } from '@/lib/category-pastels';
import { motion } from 'framer-motion';

interface CategoryImageGridProps {
  parentGroup: string;
  title: string;
  activeCategories?: Set<string>;
}

interface CategoryMeta {
  count: number;
  images: string[];
  newCount: number;
}

function buildCategoryMeta(
  productCategories: { category: string; products: any[] }[],
): Record<string, CategoryMeta> {
  const map: Record<string, CategoryMeta> = {};
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const pc of productCategories) {
    const products = pc.products ?? [];
    const images: string[] = [];
    let newCount = 0;
    for (const p of products) {
      if (p.image_url && images.length < 4) {
        images.push(p.image_url);
      }
      if (p.created_at && new Date(p.created_at).getTime() > sevenDaysAgo) {
        newCount++;
      }
    }
    map[pc.category] = { count: products.length, images, newCount };
  }
  return map;
}

function CategoryImageGridInner({ parentGroup, title, activeCategories }: CategoryImageGridProps) {
  const { groupedConfigs, isLoading } = useCategoryConfigs();
  const { data: productCategories = [], isLoading: productsLoading } = useProductsByCategory();
  const ml = useMarketplaceLabels();

  const allCategories = groupedConfigs[parentGroup] || [];
  const metaMap = useMemo(() => buildCategoryMeta(productCategories), [productCategories]);

  const categories = useMemo(() => {
    const filtered = activeCategories
      ? allCategories.filter(c => activeCategories.has(c.category))
      : allCategories;
    return filtered.filter(c => {
      const meta = metaMap[c.category];
      return meta && meta.count > 0;
    });
  }, [allCategories, activeCategories, metaMap]);

  if (isLoading || productsLoading) {
    return (
      <div className="px-4 mb-6">
        <Skeleton className="h-5 w-40 mb-3" />
        <div className="flex gap-3 overflow-x-auto scrollbar-hide">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="w-32 h-40 rounded-2xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (categories.length === 0) return null;

  // Use horizontal scroll for ≤5 categories, grid for more
  const useScrollLayout = categories.length <= 5;

  return (
    <div className="mb-6">
      {/* Section header */}
      <div className="flex items-center justify-between mb-3 px-4">
        <div className="flex items-center gap-2">
          <div className="w-1 h-5 rounded-full bg-primary" />
          <h3 className="font-extrabold text-[15px] text-foreground tracking-tight">{title}</h3>
        </div>
        <Link
          to={`/category/${parentGroup}`}
          className="text-[11px] font-bold text-primary flex items-center gap-0.5 px-2.5 py-1 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
        >
          See all <ChevronRight size={12} />
        </Link>
      </div>

      {/* Horizontal scrollable cards */}
      {useScrollLayout ? (
        <div className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1">
          {categories.map((cat, index) => (
            <CategoryCard
              key={cat.category}
              cat={cat}
              meta={metaMap[cat.category] || { count: 0, images: [], newCount: 0 }}
              index={index}
              variant="wide"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5 px-4">
          {categories.slice(0, 9).map((cat, index) => (
            <CategoryCard
              key={cat.category}
              cat={cat}
              meta={metaMap[cat.category] || { count: 0, images: [], newCount: 0 }}
              index={index}
              variant="compact"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryCard({
  cat,
  meta,
  index,
  variant,
}: {
  cat: any;
  meta: CategoryMeta;
  index: number;
  variant: 'wide' | 'compact';
}) {
  const images = meta.images.length > 0
    ? meta.images
    : cat.imageUrl ? [cat.imageUrl] : [];

  const isWide = variant === 'wide';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: 'easeOut' }}
      className={isWide ? 'shrink-0' : ''}
    >
      <Link
        to={`/category/${cat.parentGroup}?sub=${cat.category}`}
        className="block group active:scale-[0.97] transition-transform duration-150"
      >
        <div className={cn(
          'relative overflow-hidden rounded-2xl border border-border/25 backdrop-blur-xl transition-all duration-300',
          'bg-card/60 hover:bg-card/80 hover:border-border/40 hover:shadow-lg',
          isWide ? 'w-36' : 'w-full'
        )}>
          {/* Hero image section */}
          <div className={cn(
            'relative overflow-hidden',
            isWide ? 'h-24' : 'aspect-[4/3]'
          )}>
            {images.length > 0 ? (
              <>
                {/* Primary image fills the space */}
                <img
                  src={optimizedImageUrl(images[0], { width: 240, quality: 75 })}
                  alt={cat.displayName}
                  className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                  loading="lazy"
                  decoding="async"
                  onError={handleImageError}
                />
                {/* Soft gradient overlay for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />

                {/* Secondary thumbnail overlay (if 2+ images) */}
                {images.length >= 2 && (
                  <div className="absolute bottom-1.5 right-1.5 w-8 h-8 rounded-lg overflow-hidden ring-2 ring-white/30 shadow-md">
                    <img
                      src={optimizedImageUrl(images[1], { width: 64, quality: 60 })}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      onError={handleImageError}
                    />
                  </div>
                )}

                {/* Count overlay on image */}
                {meta.count > 0 && (
                  <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-sm">
                    <span className="text-[9px] font-bold text-white">
                      {meta.count} {meta.count === 1 ? 'item' : 'items'}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full bg-muted/30 flex items-center justify-center">
                <DynamicIcon
                  name={cat.icon}
                  size={32}
                  className="text-muted-foreground/60"
                />
              </div>
            )}

            {/* New badge */}
            {meta.newCount > 0 && (
              <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full bg-primary text-primary-foreground flex items-center gap-0.5 shadow-md">
                <Sparkles size={8} />
                <span className="text-[8px] font-bold">{meta.newCount} new</span>
              </div>
            )}
          </div>

          {/* Label bar */}
          <div className="px-2.5 py-2 flex items-center justify-between gap-1">
            <p className="text-[11px] font-semibold leading-tight line-clamp-1 text-foreground flex-1">
              {cat.displayName}
            </p>
            <ArrowRight size={12} className="shrink-0 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-300" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export const CategoryImageGrid = memo(CategoryImageGridInner);
