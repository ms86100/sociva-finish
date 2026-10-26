import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import {
  curatedCategoryArt,
  curatedCuisineArt,
  curatedMealArt,
} from '@/lib/food-chip-art';
import type { FoodMealId } from '@/lib/food-facets';
import type { DiscoveryIntent } from '@/lib/discovery-intents';

function mealIdFromIntent(intent: DiscoveryIntent): FoodMealId | null {
  if (intent.kind !== 'food_mood' || !intent.id.startsWith('mood:')) return null;
  const id = intent.id.slice('mood:'.length);
  if (id === 'breakfast' || id === 'lunch' || id === 'dinner' || id === 'snack') return id;
  return null;
}

function categoryIdFromIntent(intent: DiscoveryIntent): string | null {
  if (intent.kind !== 'category' || !intent.id.startsWith('cat:')) return null;
  return intent.id.slice('cat:'.length);
}

function cuisineIdFromIntent(intent: DiscoveryIntent): string | null {
  if (intent.kind !== 'food_mood' || !intent.id.startsWith('mood:')) return null;
  if (mealIdFromIntent(intent)) return null;
  return intent.id.slice('mood:'.length);
}

/**
 * Meal / cuisine / Home Food always use locked art (blank listing thumbs used to
 * leave white circles). Other category chips keep their live listing photo.
 */
function chipPhoto(intent: DiscoveryIntent): string | null {
  const meal = mealIdFromIntent(intent);
  const category = categoryIdFromIntent(intent);
  const cuisine = cuisineIdFromIntent(intent);
  if (meal) return curatedMealArt(meal) || intent.imageUrl || null;
  if (cuisine) return curatedCuisineArt(cuisine) || intent.imageUrl || null;
  if (category === 'home_food') {
    return curatedCategoryArt('home_food') || intent.imageUrl || null;
  }
  return intent.imageUrl || curatedCategoryArt(category) || null;
}

interface DiscoveryChipRailProps {
  intents: DiscoveryIntent[];
  className?: string;
  /** Home uses this as the filter bar, so the "Nearby now" label stays off. */
  showTitle?: boolean;
  selectedIds?: string[];
  onSelect?: (intent: DiscoveryIntent) => void;
  /**
   * lobby = mockup snippet row: five equal circles across the width
   * (Home Food, Cafe, Snacks, Pickles, Breakfast).
   */
  layout?: 'scroll' | 'lobby';
}

export function DiscoveryChipRail({
  intents,
  className,
  showTitle = true,
  selectedIds = [],
  onSelect,
  layout = 'scroll',
}: DiscoveryChipRailProps) {
  const navigate = useNavigate();
  if (intents.length === 0) return null;

  const lobby = layout === 'lobby';

  return (
    <div className={cn(lobby ? 'px-3 pt-3 pb-2' : 'px-4 pt-1 pb-2.5', className)}>
      {showTitle && (
        <p className="mb-2 text-[13px] font-extrabold tracking-tight text-foreground">
          Nearby now
        </p>
      )}
      {lobby ? (
        <div
          className="grid grid-cols-5 gap-1"
          data-testid="discovery-chip-lobby"
        >
          {intents.slice(0, 5).map((intent) => (
            <ChipButton
              key={intent.id}
              intent={intent}
              selected={selectedIds.includes(intent.id)}
              lobby
              onActivate={() => {
                hapticSelection();
                if (onSelect) onSelect(intent);
                else navigate(intent.href);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="discovery-chip-scroll scrollbar-hide">
          <div className="flex w-max items-start gap-3.5 pr-4">
            {intents.map((intent) => (
              <ChipButton
                key={intent.id}
                intent={intent}
                selected={selectedIds.includes(intent.id)}
                onActivate={() => {
                  hapticSelection();
                  if (onSelect) onSelect(intent);
                  else navigate(intent.href);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChipButton({
  intent,
  selected,
  lobby,
  onActivate,
}: {
  intent: DiscoveryIntent;
  selected: boolean;
  lobby?: boolean;
  onActivate: () => void;
}) {
  const meal = mealIdFromIntent(intent);
  const category = categoryIdFromIntent(intent);
  const cuisine = cuisineIdFromIntent(intent);
  const preferred = chipPhoto(intent);
  const [overrideSrc, setOverrideSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const src = overrideSrc || preferred;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onActivate}
      className={cn(
        'flex flex-col items-center active:scale-95',
        lobby ? 'min-w-0 w-full gap-1.5' : 'w-[4.5rem] shrink-0 gap-1.5',
      )}
    >
      {/*
        Cooking-nearby shell: outer disc always owns the ring width. Selected fills
        primary green; idle stays transparent so layout does not jump.
      */}
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full',
          lobby ? 'h-[3.6rem] w-[3.6rem] p-[3px]' : 'h-16 w-16 p-[3px]',
          selected ? 'bg-primary' : 'bg-transparent',
        )}
      >
        <span
          className={cn(
            'relative flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-muted',
            'shadow-[0_0_0_2px_hsl(var(--background))]',
            intent.kind === 'food_mood' && (!src || failed) && 'bg-gradient-to-br from-amber-100/80 to-orange-50/70',
          )}
        >
          {src && !failed ? (
            <img
              src={optimizedImageUrl(src, { width: 120, quality: 70 })}
              alt=""
              className="h-full w-full object-cover object-center"
              onError={() => {
                const fallback =
                  curatedMealArt(meal)
                  || curatedCategoryArt(category)
                  || curatedCuisineArt(cuisine);
                if (fallback && src !== fallback) {
                  setOverrideSrc(fallback);
                  return;
                }
                setFailed(true);
              }}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40 text-foreground">
              <DynamicIcon name={intent.icon} size={22} />
            </span>
          )}
        </span>
      </span>
      <span className={cn(
        'text-center font-semibold leading-tight text-foreground',
        lobby ? 'w-full truncate text-[10px]' : 'line-clamp-2 text-[10px]',
        selected && 'text-primary',
      )}>
        {intent.label}
      </span>
    </button>
  );
}
