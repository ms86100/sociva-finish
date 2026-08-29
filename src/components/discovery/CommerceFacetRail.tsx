import { useState, type ReactNode } from 'react';
import { Sparkles, SlidersHorizontal, Check, X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hapticSelection } from '@/lib/haptics';
import {
  CommerceFacetState,
  DynamicFacetChip,
  countActiveCommerceFacets,
  emptyCommerceFacetState,
} from '@/lib/commerce-facets';
import { isFoodParentGroup, TASTE_MOODS, countFoodFacets } from '@/lib/food-facets';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';

interface CommerceFacetRailProps {
  value: CommerceFacetState;
  onChange: (next: CommerceFacetState) => void;
  chips: DynamicFacetChip[];
  parentGroup?: string | null;
  className?: string;
  showFilterButton?: boolean;
}

export function CommerceFacetRail({
  value,
  onChange,
  chips,
  parentGroup,
  className,
  showFilterButton = true,
}: CommerceFacetRailProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const isFood = isFoodParentGroup(parentGroup);
  const activeCount = countActiveCommerceFacets(value);

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
    </div>
  );
}
