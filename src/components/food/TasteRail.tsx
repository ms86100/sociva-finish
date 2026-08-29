import { useState, type ReactNode } from 'react';
import { Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import {
  COURSE_EMOJI,
  CUISINE_EMOJI,
  FOOD_COURSES,
  FOOD_CUISINES,
  FOOD_MEALS,
  MEAL_EMOJI,
  TASTE_MOODS,
  countFoodFacets,
  emptyFoodFacets,
  isTasteMoodActive,
  toggleTasteMood,
  productMatchesFoodFacets,
  type FoodFacets,
  type TasteMood,
} from '@/lib/food-facets';
import type { TasteBrowseState } from '@/lib/food-taste';
import { SORT_OPTIONS, type SortKey } from '@/lib/marketplace-constants';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';

interface TasteRailProps {
  value: TasteBrowseState;
  onChange: (next: TasteBrowseState) => void;
  showMoods?: boolean;
  showUtilities?: boolean;
  showOpenNow?: boolean;
  sortBy?: SortKey;
  onSortChange?: (key: SortKey) => void;
  moods?: readonly TasteMood[];
  inventory?: Array<{ tags?: string[] | null; cuisine_type?: string | null; name?: string }>;
  className?: string;
}

function patchFacets(value: TasteBrowseState, facets: FoodFacets): TasteBrowseState {
  return { ...value, ...facets };
}

export function TasteRail({
  value,
  onChange,
  showMoods = true,
  showUtilities = true,
  showOpenNow,
  sortBy,
  onSortChange,
  moods = TASTE_MOODS,
  inventory,
  className,
}: TasteRailProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const facetCount = countFoodFacets(value);
  const includeOpenNow = showOpenNow ?? showUtilities;

  const setFacets = (facets: FoodFacets) => onChange(patchFacets(value, facets));

  return (
    <div className={cn('px-4 py-2', className)}>
      <div className="taste-rail-scroll scrollbar-hide">
        <div className="flex w-max items-center gap-1.5 pr-2">
          {showMoods && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setSheetOpen(true);
              }}
              className={cn(
                'relative flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold',
                facetCount
                  ? 'border-amber-500/50 bg-amber-500/15 text-foreground'
                  : 'border-border/70 bg-background/80 text-muted-foreground backdrop-blur-sm',
              )}
              aria-label="Open taste filters"
            >
              <Sparkles size={12} className="text-amber-500" />
              Taste
              {facetCount > 0 && (
                <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
                  {facetCount}
                </span>
              )}
            </button>
          )}

          {includeOpenNow && (
            <UtilityChip
              active={value.openNow}
              onClick={() => {
                hapticSelection();
                onChange({ ...value, openNow: !value.openNow });
              }}
            >
              Open
            </UtilityChip>
          )}
          {showUtilities && (
            <UtilityChip
              active={value.veg}
              onClick={() => {
                hapticSelection();
                onChange({ ...value, veg: !value.veg });
              }}
            >
              Veg
            </UtilityChip>
          )}

          {showMoods && moods.map((mood) => {
            const active = isTasteMoodActive(mood, value);
            return (
              <button
                key={mood.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  hapticSelection();
                  setFacets(toggleTasteMood(mood, value));
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-medium',
                  active
                    ? 'border-amber-500/60 bg-amber-500/15 text-foreground'
                    : 'border-border/70 bg-background/80 text-muted-foreground backdrop-blur-sm',
                )}
              >
                <span>{mood.emoji}</span>
                {mood.label}
              </button>
            );
          })}

          {onSortChange && sortBy && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setSortOpen(true);
              }}
              className={cn(
                'shrink-0 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold',
                sortBy !== 'relevance'
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/70 bg-background/80 text-muted-foreground',
              )}
            >
              {SORT_OPTIONS.find((o) => o.key === sortBy)?.label || 'Sort'}
            </button>
          )}

          {facetCount > 0 && (
            <button
              type="button"
              onClick={() => setFacets(emptyFoodFacets())}
              className="shrink-0 px-2 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Taste</DrawerTitle>
            <DrawerDescription>
              Mix cuisine, meal, and course. These never become extra folders.
            </DrawerDescription>
          </DrawerHeader>
          <div className="space-y-5 overflow-y-auto px-4 pb-2">
            <SheetSection label="Cuisine">
              {FOOD_CUISINES.filter((opt) => !inventory?.length || inventory.some((p) => productMatchesFoodFacets(p, { cuisine: opt.id }))).map((opt) => (
                <SheetTile
                  key={opt.id}
                  emoji={CUISINE_EMOJI[opt.id]}
                  label={opt.label}
                  active={value.cuisine === opt.id}
                  onClick={() => setFacets({
                    ...value,
                    cuisine: value.cuisine === opt.id ? null : opt.id,
                  })}
                />
              ))}
            </SheetSection>
            <SheetSection label="Meal">
              {FOOD_MEALS.filter((opt) => !inventory?.length || inventory.some((p) => productMatchesFoodFacets(p, { meal: opt.id }))).map((opt) => (
                <SheetTile
                  key={opt.id}
                  emoji={MEAL_EMOJI[opt.id]}
                  label={opt.label}
                  active={value.meal === opt.id}
                  onClick={() => setFacets({
                    ...value,
                    meal: value.meal === opt.id ? null : opt.id,
                  })}
                />
              ))}
            </SheetSection>
            <SheetSection label="Course">
              {FOOD_COURSES.filter((opt) => !inventory?.length || inventory.some((p) => productMatchesFoodFacets(p, { course: opt.id }))).map((opt) => (
                <SheetTile
                  key={opt.id}
                  emoji={COURSE_EMOJI[opt.id]}
                  label={opt.label}
                  active={value.course === opt.id}
                  onClick={() => setFacets({
                    ...value,
                    course: value.course === opt.id ? null : opt.id,
                  })}
                />
              ))}
            </SheetSection>
          </div>
          <DrawerFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setFacets(emptyFoodFacets())}
            >
              <X size={14} className="mr-1" />
              Clear taste
            </Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              Show dishes
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {onSortChange && (
        <Drawer open={sortOpen} onOpenChange={setSortOpen}>
          <DrawerContent>
            <DrawerHeader className="text-left">
              <DrawerTitle>Sort</DrawerTitle>
            </DrawerHeader>
            <div className="grid gap-1.5 px-4 pb-6">
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => {
                    onSortChange(opt.key);
                    setSortOpen(false);
                  }}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left text-sm font-medium',
                    sortBy === opt.key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      )}
    </div>
  );
}

function UtilityChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1.5 text-[11px] font-medium',
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border/70 bg-background/80 text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}

function SheetSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-3 gap-2">{children}</div>
    </div>
  );
}

function SheetTile({
  emoji,
  label,
  active,
  onClick,
}: {
  emoji: string;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        hapticSelection();
        onClick();
      }}
      className={cn(
        'flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-center transition-all active:scale-95',
        active
          ? 'border-amber-500/60 bg-gradient-to-br from-amber-500/20 to-orange-500/10'
          : 'border-border/70 bg-muted/30',
      )}
    >
      <span className="text-2xl leading-none">{emoji}</span>
      <span className="text-[11px] font-semibold leading-tight">{label}</span>
    </button>
  );
}
