// @ts-nocheck
import { useState, useEffect, useCallback, useMemo, forwardRef } from 'react';
import { optimizedImageUrl, handleImageError } from '@/utils/imageHelpers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useProductsByCategory } from '@/hooks/queries/useProductsByCategory';
import { FestivalBannerModule } from './FestivalBannerModule';

/**
 * Extract the target sub-category from a banner link_url like
 * "/category/food_beverages?sub=groceries" → "groceries"
 */
function extractSubCategory(linkUrl: string | null): string | null {
  if (!linkUrl) return null;
  try {
    const match = linkUrl.match(/[?&]sub=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

export function FeaturedBanners() {
  const { effectiveSocietyId } = useAuth();
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);

  const queryClient = useQueryClient();
  const { data: productCategories = [] } = useProductsByCategory();

  const categoriesWithProducts = useMemo(() => {
    const set = new Set<string>();
    for (const cat of productCategories) {
      if (cat.products.length > 0) set.add(cat.category);
    }
    return set;
  }, [productCategories]);

  const { data: rawBanners = [], isLoading } = useQuery({
    queryKey: ['featured-banners', effectiveSocietyId],
    queryFn: async () => {
      // Use server-side RPC for schedule + society filtering
      const { data, error } = await supabase.rpc('active_banners_for_society', {
        p_society_id: effectiveSocietyId || null,
      });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
    refetchOnMount: true,
  });

  // Separate classic vs festival banners
  const classicBanners = useMemo(() => {
    return rawBanners
      .filter((b: any) => (b.banner_type || 'classic') === 'classic')
      .filter((banner: any) => {
        const targetSub = extractSubCategory(banner.link_url);
        if (!targetSub) return true;
        return categoriesWithProducts.has(targetSub);
      });
  }, [rawBanners, categoriesWithProducts]);

  const festivalBanners = useMemo(() => {
    return rawBanners.filter((b: any) => b.banner_type === 'festival');
  }, [rawBanners]);

  // Fetch sections for festival banners
  const festivalBannerIds = useMemo(
    () => festivalBanners.map((b: any) => b.id),
    [festivalBanners]
  );

  const { data: allSections = [] } = useQuery({
    queryKey: ['banner-sections', festivalBannerIds],
    queryFn: async () => {
      if (festivalBannerIds.length === 0) return [];
      const { data } = await supabase
        .from('banner_sections')
        .select('id, banner_id, title, subtitle, icon_emoji, display_order, product_source_type, product_source_value')
        .in('banner_id', festivalBannerIds)
        .order('display_order');
      return data || [];
    },
    enabled: festivalBannerIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const sectionsByBanner = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of allSections) {
      const list = map.get(s.banner_id) || [];
      list.push(s);
      map.set(s.banner_id, list);
    }
    return map;
  }, [allSections]);

  // Realtime subscription for featured_items
  useEffect(() => {
    const channel = supabase
      .channel('featured-items-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'featured_items' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['featured-banners'] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Auto-scroll classic banners
  const [userInteracting, setUserInteracting] = useState(false);
  const autoRotateMs = ((classicBanners[activeIndex] as any)?.auto_rotate_seconds || 4) * 1000;
  useEffect(() => {
    if (classicBanners.length <= 1 || userInteracting) return;
    const interval = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % classicBanners.length);
    }, autoRotateMs);
    return () => clearInterval(interval);
  }, [classicBanners.length, userInteracting, autoRotateMs]);

  useEffect(() => {
    const container = document.getElementById('banner-carousel');
    if (!container) return;
    let resumeTimeout: ReturnType<typeof setTimeout>;
    const handleTouchStart = () => {
      setUserInteracting(true);
      clearTimeout(resumeTimeout);
    };
    const handleTouchEnd = () => {
      resumeTimeout = setTimeout(() => setUserInteracting(false), 8000);
    };
    container.addEventListener('touchstart', handleTouchStart, { passive: true });
    container.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchend', handleTouchEnd);
      clearTimeout(resumeTimeout);
    };
  }, []);

  useEffect(() => {
    const container = document.getElementById('banner-carousel');
    if (container && container.children[activeIndex]) {
      const child = container.children[activeIndex] as HTMLElement;
      const scrollLeft = child.offsetLeft - (container.offsetWidth - child.offsetWidth) / 2;
      container.scrollTo({ left: Math.max(0, scrollLeft), behavior: 'smooth' });
    }
  }, [activeIndex]);

  useEffect(() => {
    const container = document.getElementById('banner-carousel');
    if (!container || classicBanners.length <= 1) return;

    let scrollTimeout: ReturnType<typeof setTimeout>;
    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const containerRect = container.getBoundingClientRect();
        const centerX = containerRect.left + containerRect.width / 2;
        let closestIdx = 0;
        let closestDist = Infinity;
        Array.from(container.children).forEach((child, idx) => {
          const childRect = (child as HTMLElement).getBoundingClientRect();
          const childCenter = childRect.left + childRect.width / 2;
          const dist = Math.abs(childCenter - centerX);
          if (dist < closestDist) {
            closestDist = dist;
            closestIdx = idx;
          }
        });
        setActiveIndex(closestIdx);
      }, 80);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [classicBanners.length]);

  const scrollToIndex = useCallback((idx: number) => {
    setActiveIndex(idx);
  }, []);

  if (isLoading) {
    return (
      <div className="px-4 my-4">
        <Skeleton className="w-full aspect-[2.5/1] rounded-2xl" />
      </div>
    );
  }

  if (classicBanners.length === 0 && festivalBanners.length === 0) return null;

  return (
    <div className="my-4">
      {/* Festival Banners — rendered as full-width modules */}
      {festivalBanners.map((banner: any) => {
        const sections = sectionsByBanner.get(banner.id) || [];
        if (sections.length === 0) return null;
        return (
          <FestivalBannerModule
            key={banner.id}
            banner={banner}
            sections={sections}
          />
        );
      })}

      {/* Classic Banner Carousel */}
      {classicBanners.length > 0 && (
        <>
          <div
            id="banner-carousel"
            className="flex gap-3 overflow-x-auto scrollbar-hide px-4 pb-1 snap-x snap-mandatory"
          >
            {classicBanners.map((banner: any, idx: number) => (
              <div
                key={banner.id}
                onClick={() => {
                  const ctaConfig = banner.cta_config || {};
                  const action = ctaConfig.action || 'link';
                  if (action === 'category' && ctaConfig.target) {
                    navigate(`/category/${ctaConfig.target}`);
                  } else if (action === 'collection' && ctaConfig.target) {
                    navigate(`/festival-collection/${banner.id}/${ctaConfig.target}`);
                  } else if (banner.link_url) {
                    navigate(banner.link_url);
                  }
                }}
                className={cn(
                  'shrink-0 w-[85vw] sm:w-[400px] rounded-3xl overflow-hidden snap-center',
                  'border border-border/20 dark:border-transparent',
                  'banner-depth',
                  'transition-all duration-200 active:scale-[0.99]',
                  (banner.link_url || banner.cta_config?.target) && 'cursor-pointer'
                )}
                style={{ animationDelay: `${idx * 0.1}s` }}
              >
                <BannerContent banner={banner} />
              </div>
            ))}
          </div>

          {classicBanners.length > 1 && (
            <div className="flex justify-center gap-1.5 mt-2.5">
              {classicBanners.map((_: any, idx: number) => (
                <button
                  key={idx}
                  onClick={() => scrollToIndex(idx)}
                  aria-label={`Go to banner ${idx + 1}`}
                  className="rounded-full transition-all duration-300 min-h-[24px] min-w-[24px] flex items-center justify-center"
                >
                  <span className={cn(
                    'rounded-full transition-all duration-300',
                    idx === activeIndex
                      ? 'w-5 h-1.5 bg-primary'
                      : 'w-1.5 h-1.5 bg-border'
                  )} />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Template-based rendering ── */
const BannerContent = forwardRef<HTMLDivElement, { banner: any }>(
  function BannerContent({ banner }, ref) {
    const template = banner.template || 'image_only';
    const { title, subtitle, image_url, button_text, bg_color = '#16a34a' } = banner;

    if (template === 'image_only') {
      return image_url ? (
        <img ref={ref as any} src={optimizedImageUrl(image_url, { width: 600, quality: 80 })} alt={title || 'Featured'} className="w-full h-36 object-cover" loading="lazy" decoding="async" onError={handleImageError} />
      ) : (
        <div ref={ref} className="w-full h-36 flex items-center justify-center p-6 bg-primary">
          <h3 className="text-lg font-bold text-primary-foreground text-center">{title || 'Featured'}</h3>
        </div>
      );
    }

    if (template === 'text_overlay') {
      return (
        <div ref={ref} className="relative w-full h-36">
          {image_url ? (
             <img src={optimizedImageUrl(image_url, { width: 600, quality: 80 })} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" onError={handleImageError} />
          ) : (
            <div className="w-full h-full" style={{ backgroundColor: bg_color }} />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent flex flex-col justify-end p-3">
            <h3 className="text-white font-bold text-sm">{title}</h3>
            {subtitle && <p className="text-white/80 text-xs mt-0.5">{subtitle}</p>}
            {button_text && (
              <span className="mt-1.5 inline-block bg-white text-black text-xs font-bold px-3 py-1 rounded-full w-fit">
                {button_text}
              </span>
            )}
          </div>
        </div>
      );
    }

    if (template === 'split_left') {
      return (
        <div ref={ref} className="flex h-36" style={{ backgroundColor: bg_color }}>
          <div className="flex-1 flex flex-col justify-center p-3">
            <h3 className="text-white font-bold text-sm leading-tight">{title}</h3>
            {subtitle && <p className="text-white/80 text-[10px] mt-1">{subtitle}</p>}
            {button_text && (
              <span className="mt-1.5 inline-block bg-white text-xs font-bold px-3 py-1 rounded-full w-fit" style={{ color: bg_color }}>
                {button_text}
              </span>
            )}
          </div>
          {image_url && (
            <div className="w-2/5 shrink-0">
              <img src={optimizedImageUrl(image_url, { width: 300, quality: 80 })} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" onError={handleImageError} />
            </div>
          )}
        </div>
      );
    }

    if (template === 'gradient_cta') {
      return (
        <div
          ref={ref}
          className="w-full h-36 flex flex-col items-center justify-center text-center p-3"
          style={{ background: `linear-gradient(135deg, ${bg_color}, ${bg_color}cc)` }}
        >
          <h3 className="text-white font-extrabold text-base">{title}</h3>
          {subtitle && <p className="text-white/85 text-xs mt-1 max-w-[80%]">{subtitle}</p>}
          {button_text && (
            <span className="mt-2 bg-white text-xs font-bold px-4 py-1.5 rounded-full" style={{ color: bg_color }}>
              {button_text}
            </span>
          )}
        </div>
      );
    }

    // minimal_text
    return (
      <div ref={ref} className="w-full h-36 flex flex-col items-center justify-center p-5 bg-card border-l-4" style={{ borderColor: bg_color }}>
        <h3 className="font-bold text-base text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-1 text-center">{subtitle}</p>}
        {button_text && (
          <span className="mt-2 text-xs font-bold px-4 py-1.5 rounded-full border" style={{ color: bg_color, borderColor: bg_color }}>
            {button_text}
          </span>
        )}
      </div>
    );
  }
);
