// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { useParentGroups } from '@/hooks/useParentGroups';
import { ServiceCategory } from '@/types/categories';
import { cn } from '@/lib/utils';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { DynamicIcon } from '@/components/ui/DynamicIcon';

interface CategoryGroupGridProps {
  variant?: 'compact' | 'expanded' | 'selection';
  selectedCategories?: ServiceCategory[];
  onCategorySelect?: (category: ServiceCategory, selected: boolean) => void;
  selectedGroup?: string | null;
  onGroupSelect?: (group: string) => void;
  excludeGroups?: string[];
}

export function CategoryGroupGrid({
  variant = 'compact',
  selectedCategories = [],
  onCategorySelect,
  selectedGroup,
  onGroupSelect,
  excludeGroups = [],
}: CategoryGroupGridProps) {
  const { groupedConfigs, isLoading: configsLoading } = useCategoryConfigs();
  const { parentGroupInfos, isLoading: groupsLoading } = useParentGroups();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const isLoading = configsLoading || groupsLoading;

  // Filter out excluded groups
  const filteredGroups = parentGroupInfos.filter(g => !excludeGroups.includes(g.value));

  if (isLoading) {
    return (
      <div className="grid grid-cols-5 gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
  }

  // Compact variant — Blinkit-style category grid with larger icons
  if (variant === 'compact') {
    const visibleGroups = filteredGroups.filter(g => groupedConfigs[g.value]?.length > 0);
    return (
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 py-1">
        {visibleGroups.map(({ value, label, icon, color }) => (
          <Link
            key={value}
            to={`/category/${value}`}
            className="flex flex-col items-center gap-1 min-w-[64px] shrink-0 group"
          >
            <div
              className={cn(
                'w-14 h-14 rounded-xl flex items-center justify-center text-2xl transition-transform group-hover:scale-105',
                'bg-muted/60 border border-border/30'
              )}
            >
              <DynamicIcon name={icon} size={24} />
            </div>
            <span className="text-[10px] font-medium text-center leading-tight text-foreground line-clamp-2 max-w-[64px]">
              {label}
            </span>
          </Link>
        ))}
      </div>
    );
  }

  // Expanded variant with sub-categories visible
  if (variant === 'expanded') {
    return (
      <div className="space-y-6">
        {filteredGroups.filter(g => groupedConfigs[g.value]?.length > 0).map(({ value, label, icon, color, description }) => (
          <div key={value} className="space-y-3">
            <button
              onClick={() => setExpandedGroup(expandedGroup === value ? null : value)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-lg', color)}>
                  <DynamicIcon name={icon} size={18} />
                </div>
                <div className="text-left">
                  <h3 className="font-semibold">{label}</h3>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
              {expandedGroup === value ? (
                <ChevronDown size={20} className="text-muted-foreground" />
              ) : (
                <ChevronRight size={20} className="text-muted-foreground" />
              )}
            </button>

            {expandedGroup === value && (
              <div className="grid grid-cols-3 gap-2 pl-13">
                {groupedConfigs[value]?.map((config) => (
                  <Link
                    key={config.category}
                    to={`/category/${value}?sub=${config.category}`}
                    className="flex flex-col items-center gap-1 p-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
                  >
                    <DynamicIcon name={config.icon} size={20} />
                    <span className="text-xs font-medium text-center">{config.displayName}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Selection variant for seller registration
  if (variant === 'selection') {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {filteredGroups.filter(g => groupedConfigs[g.value]?.length > 0).map(({ value, label, icon, color }) => (
            <button
              key={value}
              onClick={() => onGroupSelect?.(value)}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border-2 transition-all',
                selectedGroup === value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-muted-foreground/30'
              )}
            >
              <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-lg', color)}>
                <DynamicIcon name={icon} size={20} />
              </div>
              <span className="font-medium text-sm">{label}</span>
            </button>
          ))}
        </div>

        {selectedGroup && groupedConfigs[selectedGroup] && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Select your categories:</p>
            <div className="grid grid-cols-2 gap-2">
              {groupedConfigs[selectedGroup].map((config) => {
                const isSelected = selectedCategories.includes(config.category);
                return (
                  <button
                    key={config.category}
                    onClick={() => onCategorySelect?.(config.category, !isSelected)}
                    className={cn(
                      'flex items-center gap-2 p-3 rounded-lg border transition-all text-left',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/30'
                    )}
                  >
                    <DynamicIcon name={config.icon} size={18} />
                    <span className="text-sm font-medium">{config.displayName}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
