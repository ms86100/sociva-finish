// @ts-nocheck
import { useState } from 'react';
import { SlidersHorizontal, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ProductCategory } from '@/types/database';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useSystemSettings } from '@/hooks/useSystemSettings';

export interface FilterState {
  priceRange: [number, number];
  minRating: number;
  isVeg: boolean | null;
  categories: ProductCategory[];
  sortBy: 'rating' | 'newest' | 'price_low' | 'price_high' | 'nearest' | null;
}

interface SearchFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  showPriceFilter?: boolean;
  browseBeyond?: boolean;
  onBrowseBeyondChange?: (val: boolean) => void;
  searchRadius?: number;
  onSearchRadiusChange?: (val: number) => void;
  onSearchRadiusCommit?: (val: number) => void;
}

const defaultFilters: FilterState = {
  priceRange: [0, 50000],
  minRating: 0,
  isVeg: null,
  categories: [],
  sortBy: null,
};

export function SearchFilters({
  filters,
  onFiltersChange,
  showPriceFilter = true,
  browseBeyond,
  onBrowseBeyondChange,
  searchRadius,
  onSearchRadiusChange,
  onSearchRadiusCommit,
}: SearchFiltersProps) {
  const { configs: allCategories } = useCategoryConfigs();
  const settings = useSystemSettings();
  const maxPrice = settings.maxPriceFilter;
  const [isOpen, setIsOpen] = useState(false);
  const [localFilters, setLocalFilters] = useState(filters);
  const [localBrowseBeyond, setLocalBrowseBeyond] = useState(browseBeyond ?? true);
  const [localRadius, setLocalRadius] = useState(searchRadius ?? 5);

  const activeFilterCount = [
    filters.minRating > 0,
    filters.isVeg !== null,
    filters.categories.length > 0,
    filters.sortBy !== null,
    filters.priceRange[0] > 0 || filters.priceRange[1] < maxPrice,
  ].filter(Boolean).length;

  const handleOpen = (open: boolean) => {
    if (open) {
      setLocalFilters(filters);
      setLocalBrowseBeyond(browseBeyond ?? true);
      setLocalRadius(searchRadius ?? 5);
    }
    setIsOpen(open);
  };

  const handleApply = () => {
    onFiltersChange(localFilters);
    if (onBrowseBeyondChange && localBrowseBeyond !== browseBeyond) {
      onBrowseBeyondChange(localBrowseBeyond);
    }
    if (onSearchRadiusCommit && localRadius !== searchRadius) {
      onSearchRadiusCommit(localRadius);
    }
    setIsOpen(false);
  };

  const handleReset = () => {
    setLocalFilters(defaultFilters);
    setLocalBrowseBeyond(true);
    setLocalRadius(5);
    onFiltersChange(defaultFilters);
    if (onBrowseBeyondChange) onBrowseBeyondChange(true);
    if (onSearchRadiusCommit) onSearchRadiusCommit(5);
  };

  return (
    <Drawer open={isOpen} onOpenChange={handleOpen}>
      <DrawerTrigger asChild>
        <button className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap border transition-colors ${
          activeFilterCount > 0
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-background text-foreground'
        }`}>
          <SlidersHorizontal size={13} />
          Filters
          {activeFilterCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground px-1">
              {activeFilterCount}
            </span>
          )}
        </button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <div className="flex items-center justify-between">
            <DrawerTitle>Filters & Sort</DrawerTitle>
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Reset all
            </Button>
          </div>
        </DrawerHeader>

        <div className="px-4 space-y-6 overflow-y-auto pb-20">
          {/* Discovery Radius */}
          {onBrowseBeyondChange && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={16} className={localBrowseBeyond ? 'text-primary' : 'text-muted-foreground'} />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Nearby societies</p>
                    <p className="text-[11px] text-muted-foreground">Discover sellers beyond your community</p>
                  </div>
                </div>
                <Switch
                  checked={localBrowseBeyond}
                  onCheckedChange={setLocalBrowseBeyond}
                />
              </div>
              {localBrowseBeyond && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Search radius</span>
                    <span className="text-xs font-bold text-primary">{localRadius} km</span>
                  </div>
                  <Slider
                    value={[localRadius]}
                    onValueChange={([v]) => setLocalRadius(v)}
                    min={1}
                    max={10}
                    step={1}
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground">
                    <span>1 km</span>
                    <span>10 km</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Sort By */}
          <div>
            <Label className="text-sm font-semibold">Sort by</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {[
                { value: 'rating', label: 'Top Rated' },
                { value: 'newest', label: 'Newest' },
                { value: 'price_low', label: 'Price: Low to High' },
                { value: 'price_high', label: 'Price: High to Low' },
                { value: 'nearest', label: 'Nearest' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() =>
                    setLocalFilters({
                      ...localFilters,
                      sortBy: localFilters.sortBy === value ? null : (value as any),
                    })
                  }
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    localFilters.sortBy === value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Veg / Non-Veg */}
          <div>
            <Label className="text-sm font-semibold">Dietary Preference</Label>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() =>
                  setLocalFilters({
                    ...localFilters,
                    isVeg: localFilters.isVeg === true ? null : true,
                  })
                }
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                  localFilters.isVeg === true
                    ? 'border-veg bg-veg/10'
                    : 'border-border'
                }`}
              >
                <div className="w-4 h-4 border-2 border-veg rounded-sm flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-veg" />
                </div>
                <span className="text-sm">Veg Only</span>
              </button>
              <button
                onClick={() =>
                  setLocalFilters({
                    ...localFilters,
                    isVeg: localFilters.isVeg === false ? null : false,
                  })
                }
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors ${
                  localFilters.isVeg === false
                    ? 'border-non-veg bg-non-veg/10'
                    : 'border-border'
                }`}
              >
                <div className="w-4 h-4 border-2 border-non-veg rounded-sm flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-non-veg" />
                </div>
                <span className="text-sm">Non-Veg</span>
              </button>
            </div>
          </div>

          {/* Rating Filter */}
          <div>
            <Label className="text-sm font-semibold">Minimum Rating</Label>
            <div className="flex gap-2 mt-2">
              {[0, 3, 3.5, 4, 4.5].map((rating) => (
                <button
                  key={rating}
                  onClick={() =>
                    setLocalFilters({ ...localFilters, minRating: rating })
                  }
                  className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                    localFilters.minRating === rating
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {rating === 0 ? 'Any' : `${rating}+`}
                </button>
              ))}
            </div>
          </div>

          {/* Price Range */}
          {showPriceFilter && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Price Range</Label>
                <span className="text-sm text-muted-foreground">
                  {settings.currencySymbol}{localFilters.priceRange[0]} - {settings.currencySymbol}{localFilters.priceRange[1]}
                </span>
              </div>
              <Slider
                value={localFilters.priceRange}
                onValueChange={(value) =>
                  setLocalFilters({
                    ...localFilters,
                    priceRange: value as [number, number],
                  })
                }
                min={0}
                max={maxPrice}
                step={50}
                className="mt-4"
              />
            </div>
          )}
        </div>

        {/* Apply Button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-background border-t">
          <Button className="w-full" onClick={handleApply}>
            Apply Filters
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export { defaultFilters };
