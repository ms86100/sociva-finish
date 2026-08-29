import { useState } from 'react';
import { Sparkles, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import {
  CommerceFacetState,
  DynamicFacetChip,
  countActiveCommerceFacets,
  emptyCommerceFacetState,
} from '@/lib/commerce-facets';
import {
  COURSE_EMOJI,
  CUISINE_EMOJI,
  FOOD_COURSES,
  FOOD_CUISINES,
  FOOD_MEALS,
  MEAL_EMOJI,
  isFoodParentGroup,
  type FoodCourseId,
  type FoodCuisineId,
  type FoodMealId,
} from '@/lib/food-facets';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { SORT_OPTIONS, type SortKey } from '@/lib/marketplace-constants';

interface CommerceFacetRailProps {
  value: CommerceFacetState;
  onChange: (next: CommerceFacetState) => void;
  chips: DynamicFacetChip[];
  parentGroup?: string | null;
  className?: string;
  showFilterButton?: boolean;
  sortBy?: SortKey;
  onSortChange?: (key: SortKey) => void;
}

export function CommerceFacetRail({
  value,
  onChange,
  chips,
  parentGroup,
  className,
  showFilterButton = true,
  sortBy,
  onSortChange,
}: CommerceFacetRailProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const isFood = isFoodParentGroup(parentGroup);
  const activeCount = countActiveCommerceFacets(value);

  const foodMoodCount = (
    facet: 'cuisine' | 'meal' | 'course',
    moodVal: string,
  ) => chips.find((c) => c.type === 'food_mood' && c.value?.facet === facet && c.value?.value === moodVal)?.count ?? 0;

  const toggleFoodFacet = (facet: 'cuisine' | 'meal' | 'course', moodVal: string) => {
    hapticSelection();
    onChange({
      ...value,
      [facet]: value[facet] === moodVal ? null : moodVal,
    });
  };

  const toggleChip = (chip: DynamicFacetChip) => {
    hapticSelection();
    const next = { ...value };

    if (chip.type === 'food_mood') {
      const { facet, value: moodVal } = chip.value;
      if (next[facet] === moodVal) {
        next[facet] = null;
      } else {
        next[facet] = moodVal;
      }
    } else if (chip.type === 'action_type') {
      next.actionType = next.actionType === chip.value ? null : chip.value;
    } else if (chip.type === 'service_mode') {
      next.serviceMode = next.serviceMode === chip.value ? null : chip.value;
    } else if (chip.type === 'duration') {
      next.durationMax = next.durationMax === chip.value ? null : chip.value;
    } else if (chip.type === 'price') {
      next.priceMax = next.priceMax === chip.value ? null : chip.value;
    }

    onChange(next);
  };

  const clearAll = () => {
    hapticSelection();
    onChange(emptyCommerceFacetState());
    setSheetOpen(false);
  };

  if (chips.length === 0 && !isFood) return null;

  return (
    <div className={cn('px-4 py-1.5', className)}>
      <div className="taste-rail-scroll scrollbar-hide">
        <div className="flex w-max items-center gap-1.5 pr-2">
          {/* Main Filter / Taste trigger */}
          {showFilterButton && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                setSheetOpen(true);
              }}
              className={cn(
                'relative flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-all',
                activeCount > 0
                  ? isFood
                    ? 'border-amber-500/50 bg-amber-500/15 text-foreground'
                    : 'border-primary/50 bg-primary/15 text-primary'
                  : 'border-border/80 bg-background/90 text-muted-foreground backdrop-blur-sm'
              )}
              aria-label="Open filter drawer"
            >
              {isFood ? (
                <Sparkles size={13} className="text-amber-500" />
              ) : (
                <SlidersHorizontal size={13} className={activeCount > 0 ? 'text-primary' : 'text-muted-foreground'} />
              )}
              <span>{isFood ? 'Taste' : 'Filter'}</span>
              {activeCount > 0 && (
                <span
                  className={cn(
                    'ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white',
                    isFood ? 'bg-amber-500' : 'bg-primary'
                  )}
                >
                  {activeCount}
                </span>
              )}
            </button>
          )}

          {/* Quick Open Now Toggle */}
          <button
            type="button"
            onClick={() => {
              hapticSelection();
              onChange({ ...value, openNow: !value.openNow });
            }}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
              value.openNow
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold'
                : 'border-border/70 bg-background/80 text-muted-foreground'
            )}
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', value.openNow ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
            Open Now
          </button>

          {/* Quick Veg Toggle for Food */}
          {isFood && (
            <button
              type="button"
              onClick={() => {
                hapticSelection();
                onChange({ ...value, veg: !value.veg });
              }}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                value.veg
                  ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold'
                  : 'border-border/70 bg-background/80 text-muted-foreground'
              )}
            >
              <span className="text-[11px]">🥬</span>
              Veg Only
            </button>
          )}

          {/* Dynamic Facet Chips strictly from real inventory */}
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => toggleChip(chip)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-all active:scale-95',
                chip.isActive
                  ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                  : 'border-border/80 bg-background/90 text-foreground hover:border-primary/40'
              )}
            >
              {chip.emoji && <span className="text-xs">{chip.emoji}</span>}
              <span>{chip.label}</span>
              <span
                className={cn(
                  'ml-0.5 text-[10px] font-medium opacity-75',
                  chip.isActive ? 'text-primary-foreground' : 'text-muted-foreground'
                )}
              >
                ({chip.count})
              </span>
            </button>
          ))}

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
        </div>
      </div>

      {/* Filter Bottom Sheet Drawer */}
      <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
        <DrawerContent className="max-h-[80dvh] overflow-y-auto">
          <DrawerHeader className="pb-2">
            <div className="flex items-center justify-between">
              <DrawerTitle className="text-base font-bold flex items-center gap-2">
                {isFood ? <Sparkles size={16} className="text-amber-500" /> : <SlidersHorizontal size={16} className="text-primary" />}
                {isFood ? 'Food & Taste Preferences' : 'Filter by Service & Booking Options'}
              </DrawerTitle>
              {activeCount > 0 && (
                <button onClick={clearAll} className="text-xs font-semibold text-primary flex items-center gap-1">
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
            <DrawerDescription className="text-xs text-muted-foreground">
              Filter listings based on real availability in your society
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-4 py-3 space-y-4">
            {isFood && (
              <>
                <TasteSheetSection label="Cuisine">
                  {FOOD_CUISINES.filter((opt) => opt.id !== 'other').map((opt) => {
                    const count = foodMoodCount('cuisine', opt.id);
                    const active = value.cuisine === opt.id;
                    return (
                      <TasteSheetChip
                        key={opt.id}
                        emoji={CUISINE_EMOJI[opt.id as FoodCuisineId]}
                        label={opt.label}
                        count={count}
                        active={active}
                        onClick={() => toggleFoodFacet('cuisine', opt.id)}
                      />
                    );
                  })}
                </TasteSheetSection>
                <TasteSheetSection label="Meal">
                  {FOOD_MEALS.map((opt) => {
                    const count = foodMoodCount('meal', opt.id);
                    const active = value.meal === opt.id;
                    return (
                      <TasteSheetChip
                        key={opt.id}
                        emoji={MEAL_EMOJI[opt.id as FoodMealId]}
                        label={opt.label}
                        count={count}
                        active={active}
                        onClick={() => toggleFoodFacet('meal', opt.id)}
                      />
                    );
                  })}
                </TasteSheetSection>
                <TasteSheetSection label="Course">
                  {FOOD_COURSES.map((opt) => {
                    const count = foodMoodCount('course', opt.id);
                    const active = value.course === opt.id;
                    return (
                      <TasteSheetChip
                        key={opt.id}
                        emoji={COURSE_EMOJI[opt.id as FoodCourseId]}
                        label={opt.label}
                        count={count}
                        active={active}
                        onClick={() => toggleFoodFacet('course', opt.id)}
                      />
                    );
                  })}
                </TasteSheetSection>
              </>
            )}

            {!isFood && chips.some((c) => c.type === 'food_mood') && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Cuisine, meal & course</p>
                <div className="flex flex-wrap gap-2">
                  {chips
                    .filter((c) => c.type === 'food_mood')
                    .map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => toggleChip(chip)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                          chip.isActive
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card border-border text-foreground hover:border-primary/40'
                        )}
                      >
                        {chip.emoji && <span>{chip.emoji}</span>}
                        <span>{chip.label}</span>
                        <span className="text-[10px] opacity-75">({chip.count})</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Action Type / Booking Method */}
            {chips.some((c) => c.type === 'action_type') && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Booking & Order Mode</p>
                <div className="flex flex-wrap gap-2">
                  {chips
                    .filter((c) => c.type === 'action_type')
                    .map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => toggleChip(chip)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                          chip.isActive
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card border-border text-foreground hover:border-primary/40'
                        )}
                      >
                        {chip.emoji && <span>{chip.emoji}</span>}
                        <span>{chip.label}</span>
                        <span className="text-[10px] opacity-75">({chip.count})</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Service Delivery Mode */}
            {chips.some((c) => c.type === 'service_mode') && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Location & Fulfillment</p>
                <div className="flex flex-wrap gap-2">
                  {chips
                    .filter((c) => c.type === 'service_mode')
                    .map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => toggleChip(chip)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                          chip.isActive
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card border-border text-foreground hover:border-primary/40'
                        )}
                      >
                        {chip.emoji && <span>{chip.emoji}</span>}
                        <span>{chip.label}</span>
                        <span className="text-[10px] opacity-75">({chip.count})</span>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Duration and Pricing Tiers */}
            {(chips.some((c) => c.type === 'duration') || chips.some((c) => c.type === 'price')) && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Duration & Budget</p>
                <div className="flex flex-wrap gap-2">
                  {chips
                    .filter((c) => c.type === 'duration' || c.type === 'price')
                    .map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => toggleChip(chip)}
                        className={cn(
                          'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
                          chip.isActive
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card border-border text-foreground hover:border-primary/40'
                        )}
                      >
                        {chip.emoji && <span>{chip.emoji}</span>}
                        <span>{chip.label}</span>
                        <span className="text-[10px] opacity-75">({chip.count})</span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          <DrawerFooter className="pt-2">
            <Button onClick={() => setSheetOpen(false)} className="w-full h-11 rounded-xl font-bold">
              Apply Filters {activeCount > 0 ? `(${activeCount})` : ''}
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

function TasteSheetSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function TasteSheetChip({
  emoji,
  label,
  count,
  active,
  onClick,
}: {
  emoji: string;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-card border-border text-foreground hover:border-primary/40',
        count === 0 && !active && 'opacity-50',
      )}
    >
      <span>{emoji}</span>
      <span>{label}</span>
      <span className="text-[10px] opacity-75">({count})</span>
    </button>
  );
}
