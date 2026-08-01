// @ts-nocheck
import { cn } from '@/lib/utils';

export const ITEM_STATUS_CONFIG = {
  pending: { label: 'Pending', color: 'bg-muted text-muted-foreground' },
  accepted: { label: 'Accepted', color: 'bg-info/20 text-info' },
  preparing: { label: 'Preparing', color: 'bg-warning/20 text-warning' },
  ready: { label: 'Ready', color: 'bg-success/20 text-success' },
  delivered: { label: 'Delivered', color: 'bg-success/20 text-success' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/20 text-destructive' },
} as const;

export type ItemStatus = keyof typeof ITEM_STATUS_CONFIG;

interface OrderItemStatusBadgeProps {
  status: ItemStatus;
  size?: 'sm' | 'md';
}

export function OrderItemStatusBadge({ status, size = 'sm' }: OrderItemStatusBadgeProps) {
  const config = ITEM_STATUS_CONFIG[status] || ITEM_STATUS_CONFIG.pending;
  
  return (
    <span
      className={cn(
        'rounded-full font-medium',
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1',
        config.color
      )}
    >
      {config.label}
    </span>
  );
}
