import { useEffect, useMemo, useState } from 'react';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useProductFavorites } from '@/hooks/useProductFavorites';
import { buildIntentRails, type IntentListing, type IntentRailSet } from '@/lib/intent-rails';
import { isFoodParentGroup } from '@/lib/food-facets';
import { markSectionOpened, readSectionOpenedAt, type SectionVisitKey } from '@/lib/section-visit';

const VISIT_KEY: Record<'shop' | 'book' | 'services', SectionVisitKey> = {
  shop: 'home',
  book: 'book',
  services: 'contact',
};

export function useIntentRailModel<T extends IntentListing>(
  mode: 'shop' | 'book' | 'services',
  products: readonly T[],
  categoryConfigs: readonly { category: string; displayName?: string; parentGroup?: string | null }[],
  limit = 12,
): IntentRailSet<T> {
  const visitKey = VISIT_KEY[mode];
  const [lastOpenedAt] = useState(() => readSectionOpenedAt(visitKey));
  const { recentIds } = useRecentlyViewed();
  const { data: favoriteIds = [] } = useProductFavorites();

  useEffect(() => {
    markSectionOpened(visitKey);
  }, [visitKey]);

  return useMemo(() => buildIntentRails({
    mode,
    products,
    recentIds,
    favoriteIds,
    lastOpenedAt,
    now: Date.now(),
    limit,
    isFood: (listing) => {
      const config = categoryConfigs.find((item) => item.category === listing.category);
      return isFoodParentGroup(config?.parentGroup);
    },
    categoryLabel: (category) => categoryConfigs.find((item) => item.category === category)?.displayName || category,
  }), [mode, products, recentIds, favoriteIds, lastOpenedAt, limit, categoryConfigs]);
}
