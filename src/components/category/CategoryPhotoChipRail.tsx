// @ts-nocheck
import { cn } from '@/lib/utils';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { Skeleton } from '@/components/ui/skeleton';

export type PhotoChipItem = {
  id: string;
  label: string;
  imageUrl?: string | null;
  icon?: string | null;
};

/**
 * Locked visual tokens for leaf-category photo chips (preferred Home/Search look).
 * Tests assert these strings so neither screen can drift to a private chip renderer.
 */
export const CATEGORY_PHOTO_CHIP_TOKENS = {
  railInner: 'flex gap-2',
  button:
    'flex flex-col items-center gap-1.5 px-3 py-2 rounded-2xl min-w-[68px] transition-all shrink-0',
  buttonActive: 'bg-primary text-primary-foreground shadow-md scale-[1.03]',
  buttonInactive: 'bg-muted/60 hover:bg-muted active:scale-95',
  photo:
    'w-9 h-9 rounded-full overflow-hidden flex items-center justify-center border',
  photoActive: 'bg-primary-foreground/15 border-primary-foreground/25',
  photoInactive: 'bg-background/40 border-white/20',
  label:
    'text-[10px] font-medium leading-tight text-center line-clamp-2 max-w-[4.5rem]',
  labelActive: 'text-primary-foreground',
  labelInactive: 'text-foreground',
} as const;

type LeafChipSource = {
  category: string;
  displayName: string;
  icon?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
};

/**
 * Inventory-backed leaf categories for Home + Search chip rails.
 * Prefer short leaf labels (Home Food, Beauty) over parent groups (Food & Beverages).
 */
export function buildLeafPhotoChipItems(
  configs: LeafChipSource[],
  inventoryCategories: Iterable<string>,
): PhotoChipItem[] {
  const live = inventoryCategories instanceof Set
    ? inventoryCategories
    : new Set(inventoryCategories);
  return configs
    .filter((c) => live.has(c.category))
    .map((c) => ({
      id: c.category,
      label: c.displayName,
      imageUrl: c.imageUrl || c.image_url || null,
      icon: c.icon || 'Package',
    }));
}

interface CategoryPhotoChipRailProps {
  items: PhotoChipItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading?: boolean;
  className?: string;
  /** Extra classes on the scroll viewport (e.g. sticky bar padding). */
  railClassName?: string;
  /** When true, tapping the already-selected chip clears selection (caller handles). */
  allowDeselect?: boolean;
}

/**
 * Horizontal rail of leaf-category chips: circular photo on top, label below,
 * in a rounded dark card. Shared by Home and Search - preferred screenshot look.
 */
export function CategoryPhotoChipRail({
  items,
  selectedId,
  onSelect,
  isLoading = false,
  className,
  railClassName,
  allowDeselect = false,
}: CategoryPhotoChipRailProps) {
  if (isLoading) {
    return (
      <div className={cn('flex gap-2 overflow-hidden', railClassName, className)}>
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-16 w-16 rounded-2xl shrink-0" />
        ))}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div className={cn('taste-rail-scroll scrollbar-hide', railClassName, className)}>
      <div className={CATEGORY_PHOTO_CHIP_TOKENS.railInner}>
        {items.map((item) => {
          const isActive = selectedId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (allowDeselect && isActive) onSelect(item.id);
                else onSelect(item.id);
              }}
              className={cn(
                CATEGORY_PHOTO_CHIP_TOKENS.button,
                isActive
                  ? CATEGORY_PHOTO_CHIP_TOKENS.buttonActive
                  : CATEGORY_PHOTO_CHIP_TOKENS.buttonInactive,
              )}
            >
              <div
                className={cn(
                  CATEGORY_PHOTO_CHIP_TOKENS.photo,
                  isActive
                    ? CATEGORY_PHOTO_CHIP_TOKENS.photoActive
                    : CATEGORY_PHOTO_CHIP_TOKENS.photoInactive,
                )}
              >
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl leading-none">
                    <DynamicIcon name={item.icon || 'Package'} size={20} />
                  </span>
                )}
              </div>
              <span
                className={cn(
                  CATEGORY_PHOTO_CHIP_TOKENS.label,
                  isActive
                    ? CATEGORY_PHOTO_CHIP_TOKENS.labelActive
                    : CATEGORY_PHOTO_CHIP_TOKENS.labelInactive,
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
