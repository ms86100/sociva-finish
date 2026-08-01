// @ts-nocheck
import { FilterState } from './SearchFilters';
import { Leaf, Star, Banknote, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSystemSettings } from '@/hooks/useSystemSettings';

interface FilterPresetsProps {
  activePreset: string | null;
  onPresetSelect: (preset: string | null, filters: Partial<FilterState>) => void;
}

export function FilterPresets({ activePreset, onPresetSelect }: FilterPresetsProps) {
  const settings = useSystemSettings();
  const threshold = settings.budgetFilterThreshold;

  const PRESETS = [
    {
      id: 'veg',
      label: 'Veg Only',
      icon: Leaf,
      color: 'text-veg',
      bgColor: 'bg-veg/10',
      filters: { isVeg: true },
    },
    {
      id: 'budget',
      label: `Under ${settings.currencySymbol}${threshold}`,
      icon: Banknote,
      color: 'text-success',
      bgColor: 'bg-success/10',
      filters: { priceRange: [0, threshold] as [number, number] },
    },
    {
      id: 'top_rated',
      label: 'Top Rated',
      icon: Star,
      color: 'text-warning',
      bgColor: 'bg-warning/10',
      filters: { minRating: 4, sortBy: 'rating' as const },
    },
    {
      id: 'featured',
      label: 'Featured',
      icon: Sparkles,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      filters: { sortBy: 'rating' as const },
    },
  ];

  const handleClick = (presetId: string, filters: Partial<FilterState>) => {
    if (activePreset === presetId) {
      onPresetSelect(null, {});
    } else {
      onPresetSelect(presetId, filters);
    }
  };

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide py-1">
      {PRESETS.map(({ id, label, icon: Icon, color, bgColor, filters }) => (
        <button
          key={id}
          onClick={() => handleClick(id, filters)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all shrink-0',
            activePreset === id
              ? 'bg-primary text-primary-foreground'
              : `${bgColor} ${color}`
          )}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
