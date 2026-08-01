// @ts-nocheck
import { Link } from 'react-router-dom';
import { useCategoryConfigs } from '@/hooks/useCategoryBehavior';
import { ProductCategory } from '@/types/database';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { DynamicIcon } from '@/components/ui/DynamicIcon';

interface CategoryGridProps {
  selectedCategory?: ProductCategory;
  onSelect?: (category: ProductCategory | undefined) => void;
  variant?: 'grid' | 'scroll';
}

export function CategoryGrid({
  selectedCategory,
  onSelect,
  variant = 'scroll',
}: CategoryGridProps) {
  const { configs, isLoading } = useCategoryConfigs();

  const handleClick = (category: ProductCategory) => {
    if (onSelect) {
      onSelect(selectedCategory === category ? undefined : category);
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="w-14 h-20 rounded-2xl shrink-0" />
        ))}
      </div>
    );
  }

  if (variant === 'grid') {
    return (
      <div className="grid grid-cols-5 gap-2">
        {configs.map((config) => (
          <button
            key={config.category}
            onClick={() => handleClick(config.category)}
            className={cn(
              'flex flex-col items-center gap-1 p-2 rounded-xl transition-all',
              selectedCategory === config.category
                ? 'bg-primary/10 ring-2 ring-primary'
                : 'hover:bg-muted'
            )}
          >
            <div className={cn('w-12 h-12 rounded-full flex items-center justify-center', config.color)}>
              <DynamicIcon name={config.icon} size={24} />
            </div>
            <span className="text-[10px] font-medium text-center leading-tight">
              {config.displayName}
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto scrollbar-hide py-2 -mx-4 px-4">
      {configs.map((config) => (
        <Link
          key={config.category}
          to={`/category/${config.parentGroup}?sub=${config.category}`}
          className="flex flex-col items-center gap-1.5 min-w-[72px]"
        >
          <div
            className={cn(
              'w-14 h-14 rounded-2xl flex items-center justify-center shadow-sm transition-transform hover:scale-105',
              config.color
            )}
          >
            <DynamicIcon name={config.icon} size={24} />
          </div>
          <span className="text-xs font-medium text-center">{config.displayName}</span>
        </Link>
      ))}
    </div>
  );
}
