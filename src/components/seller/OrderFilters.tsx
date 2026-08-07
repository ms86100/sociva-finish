// @ts-nocheck
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  FILTER_LABELS,
  type SellerOrderFilter,
  type SellerBoardCounts,
} from '@/lib/seller-order-board';
import { filterChip, scalePress } from '@/lib/motion-variants';

interface OrderFiltersProps {
  currentFilter: SellerOrderFilter;
  onFilterChange: (filter: SellerOrderFilter) => void;
  counts: SellerBoardCounts;
}

/** Primary ops chips first; terminal / rare buckets after. */
const FILTER_ORDER: SellerOrderFilter[] = [
  'all',
  'pending',
  'preparing',
  'ready',
  'in_transit',
  'cod_confirm',
  'today',
  'enquiries',
  'completed',
  'cancelled',
  'refunded',
  'no_show',
  'terminal_fail',
];

const EMPHASIS: Partial<Record<SellerOrderFilter, 'action' | 'warn' | 'muted'>> = {
  pending: 'action',
  cod_confirm: 'action',
  terminal_fail: 'warn',
  cancelled: 'muted',
  no_show: 'muted',
};

export type OrderFilter = SellerOrderFilter;

export function OrderFilters({ currentFilter, onFilterChange, counts }: OrderFiltersProps) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-0.5 px-0.5">
      {FILTER_ORDER.map((value) => {
        const count = counts[value] ?? 0;
        const active = currentFilter === value;
        const emphasis = EMPHASIS[value];
        // Hide zero-count rare buckets to reduce clutter (keep core always)
        const alwaysShow: SellerOrderFilter[] = [
          'all', 'pending', 'preparing', 'ready', 'in_transit', 'today', 'completed',
        ];
        if (!alwaysShow.includes(value) && count === 0 && !active) return null;

        return (
          <motion.button
            key={value}
            type="button"
            {...scalePress}
            variants={filterChip}
            animate={active ? 'active' : 'inactive'}
            onClick={() => onFilterChange(value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors border',
              active
                ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                : emphasis === 'action' && count > 0
                  ? 'bg-warning/15 text-warning border-warning/30 hover:bg-warning/25'
                  : emphasis === 'warn' && count > 0
                    ? 'bg-destructive/10 text-destructive border-destructive/20 hover:bg-destructive/15'
                    : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80',
            )}
          >
            {FILTER_LABELS[value]}
            <span className={cn('ml-1 tabular-nums', active ? 'opacity-90' : 'opacity-70')}>
              ({count})
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
