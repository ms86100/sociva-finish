// @ts-nocheck
import { useMemo } from 'react';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { useFestivalTakeover } from '@/hooks/queries/useActiveFestivals';
import {
  CategoryPhotoChipRail,
  buildLeafPhotoChipItems,
} from '@/components/category/CategoryPhotoChipRail';

interface ParentGroupTabsProps {
  /** Selected leaf category slug (e.g. home_food), not a parent group. */
  activeCategory: string | null;
  onCategoryChange: (category: string | null) => void;
  /** Leaf categories with live inventory in the society. */
  activeCategories?: Set<string>;
}

/**
 * Home sticky leaf-category rail - same CategoryPhotoChipRail chrome as Search.
 * Shows Home Food / Tuition / Beauty style chips (preferred look), not parent groups.
 */
export function ParentGroupTabs({
  activeCategory,
  onCategoryChange,
  activeCategories,
}: ParentGroupTabsProps) {
  const { configs, isLoading } = useCategoryConfigs();
  const takeover = useFestivalTakeover();

  const barStyle = takeover.active
    ? { backgroundColor: takeover.bg, borderColor: 'rgba(255,255,255,0.12)' }
    : undefined;

  const items = useMemo(
    () => buildLeafPhotoChipItems(configs, activeCategories || new Set()),
    [configs, activeCategories],
  );

  if (!isLoading && items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'sticky top-[max(var(--app-safe-top),3.25rem)] z-20',
        takeover.active ? 'border-b border-white/10' : 'bg-background/80 backdrop-blur-xl border-b border-border/30'
      )}
      style={barStyle}
    >
      <CategoryPhotoChipRail
        items={items}
        selectedId={activeCategory}
        isLoading={isLoading}
        railClassName="px-4 py-2"
        allowDeselect
        onSelect={(id) => {
          hapticSelection();
          onCategoryChange(activeCategory === id ? null : id);
        }}
      />
    </div>
  );
}
