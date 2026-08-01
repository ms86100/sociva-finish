// @ts-nocheck
import { cn } from '@/lib/utils';

export type OrderFilter = 'all' | 'today' | 'enquiries' | 'pending' | 'preparing' | 'ready' | 'completed';

interface OrderFiltersProps {
  currentFilter: OrderFilter;
  onFilterChange: (filter: OrderFilter) => void;
  counts: {
    all: number;
    today: number;
    enquiries: number;
    pending: number;
    preparing: number;
    ready: number;
    completed: number;
  };
}

export function OrderFilters({ currentFilter, onFilterChange, counts }: OrderFiltersProps) {
  const filters: { value: OrderFilter; label: string }[] = [
    { value: 'all', label: `All (${counts.all})` },
    { value: 'today', label: `Today (${counts.today})` },
    { value: 'enquiries', label: `Enquiries (${counts.enquiries})` },
    { value: 'pending', label: `Pending (${counts.pending})` },
    { value: 'preparing', label: `Preparing (${counts.preparing})` },
    { value: 'ready', label: `Ready (${counts.ready})` },
    { value: 'completed', label: `Done (${counts.completed})` },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
      {filters.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onFilterChange(value)}
          className={cn(
            'px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors',
            currentFilter === value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
