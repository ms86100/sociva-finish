// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';

/**
 * Blinkit-style sub-category browse grid.
 * Shows 2 rows (8 items) by default with expand toggle.
 * Pulls all active sub-categories from category_config (DB-driven).
 */
interface CategoryBrowseGridProps {
  activeCategories?: Set<string>;
}

export function CategoryBrowseGrid({ activeCategories }: CategoryBrowseGridProps = {}) {
  const { configs: allConfigs, isLoading } = useCategoryConfigs();
  const configs = activeCategories
    ? allConfigs.filter(c => activeCategories.has(c.category))
    : allConfigs;
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div className="px-4">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <Skeleton className="w-14 h-14 rounded-xl" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!configs.length) return null;

  const COLLAPSED_COUNT = 8;
  const showToggle = configs.length > COLLAPSED_COUNT;
  const visible = expanded ? configs : configs.slice(0, COLLAPSED_COUNT);

  return (
    <div className="px-4">
      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-x-2 gap-y-3">
        {visible.map((cat) => (
          <Link
            key={cat.category}
            to={`/category/${cat.parentGroup}?sub=${cat.category}`}
            className="group flex flex-col items-center gap-1"
          >
            <div
              className={cn(
                'w-14 h-14 rounded-2xl flex items-center justify-center',
                'bg-accent/50 border border-border/20',
                'transition-all group-hover:scale-105 group-hover:shadow-md group-active:scale-95'
              )}
            >
              <DynamicIcon name={cat.icon} size={22} />
            </div>
            <span className="text-[10px] font-medium text-center leading-tight text-muted-foreground line-clamp-2 max-w-[60px]">
              {cat.displayName}
            </span>
          </Link>
        ))}
      </div>

      {showToggle && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full mt-2 flex items-center justify-center gap-1 py-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {expanded ? (
            <>Show less <ChevronUp size={14} /></>
          ) : (
            <>See all categories <ChevronDown size={14} /></>
          )}
        </button>
      )}
    </div>
  );
}
