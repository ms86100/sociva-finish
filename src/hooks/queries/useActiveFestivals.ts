import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { resolveBannerSections } from '@/lib/bannerProductResolver';

export interface FestivalSection {
  id: string;
  banner_id: string;
  title: string;
  subtitle: string | null;
  icon_emoji: string | null;
  icon_color: string | null;
  display_order: number;
  product_source_type: string;
  product_source_value: string | null;
}

export interface ActiveFestival {
  banner: any;
  sections: FestivalSection[];
}

export const FESTIVAL_TAB_VALUE = '__festival__';

export function useActiveFestivals() {
  const { effectiveSocietyId } = useAuth();

  const { data: rawBanners = [], isLoading: loadingBanners } = useQuery({
    queryKey: ['featured-banners', effectiveSocietyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('active_banners_for_society', {
        p_society_id: effectiveSocietyId || null,
      });
      if (error) throw error;
      return data || [];
    },
    staleTime: 60_000,
  });

  const festivalBanners = useMemo(
    () => (rawBanners as any[]).filter((b) => b.banner_type === 'festival'),
    [rawBanners],
  );

  const festivalBannerIds = useMemo(
    () => festivalBanners.map((b: any) => b.id),
    [festivalBanners],
  );

  const { data: allSections = [], isLoading: loadingSections } = useQuery({
    queryKey: ['banner-sections', festivalBannerIds],
    queryFn: async () => {
      if (festivalBannerIds.length === 0) return [];
      const { data } = await supabase
        .from('banner_sections')
        .select('id, banner_id, title, subtitle, icon_emoji, icon_color, display_order, product_source_type, product_source_value')
        .in('banner_id', festivalBannerIds)
        .order('display_order');
      return data || [];
    },
    enabled: festivalBannerIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const festivals: ActiveFestival[] = useMemo(() => {
    const byBanner = new Map<string, FestivalSection[]>();
    for (const s of allSections as FestivalSection[]) {
      const list = byBanner.get(s.banner_id) || [];
      list.push(s);
      byBanner.set(s.banner_id, list);
    }
    return festivalBanners
      .map((banner: any) => ({
        banner,
        sections: byBanner.get(banner.id) || [],
      }))
      .filter((f) => f.sections.length > 0);
  }, [festivalBanners, allSections]);

  return {
    festivals,
    isLoading: loadingBanners || (festivalBannerIds.length > 0 && loadingSections),
  };
}

export function useFestivalTakeover() {
  const location = useLocation();
  const { effectiveSocietyId } = useAuth();
  const { festivals, isLoading } = useActiveFestivals();
  const festival = festivals[0] || null;
  const onHome = location.pathname === '/' || location.pathname === '';

  const { data: sectionProductsMap } = useQuery({
    queryKey: ['banner-batch-products', festival?.banner?.id, effectiveSocietyId],
    queryFn: () => resolveBannerSections({
      bannerId: festival!.banner.id,
      societyId: effectiveSocietyId || undefined,
      limitPerSection: 12,
    }),
    enabled: onHome && !!festival?.banner?.id,
    staleTime: 60_000,
  });

  return useMemo(() => {
    const theme = festival?.banner?.theme_config || {};
    const gradient = Array.isArray(theme.gradient) ? theme.gradient.filter(Boolean) : [];
    const bg = theme.bg || gradient[0] || '#3b0a1e';
    const accent = theme.accent || gradient[gradient.length - 1] || '#f5d76e';
    const hasInventory = !!sectionProductsMap && (festival?.sections || []).some(
      (section) => (sectionProductsMap.get(section.id) || []).length > 0,
    );
    const active = onHome && !!festival && hasInventory;

    return {
      active,
      isLoading,
      festival,
      title: festival?.banner?.title || '',
      subtitle: festival?.banner?.subtitle || '',
      badge: festival?.banner?.badge_text || '',
      bg,
      accent,
      gradient,
      canvasStyle: gradient.length >= 2
        ? { background: `linear-gradient(180deg, ${bg} 0%, ${gradient[0]} 45%, ${bg} 100%)` }
        : { backgroundColor: bg },
    };
  }, [festival, onHome, isLoading, sectionProductsMap]);
}
