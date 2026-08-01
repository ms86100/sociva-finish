// @ts-nocheck
import { Badge } from '@/components/ui/badge';
import { Truck } from 'lucide-react';

interface Props {
  onTimePct: number;
  compact?: boolean;
}

/**
 * Presentational delivery score badge — no internal RPC calls.
 * Use with useDeliveryScoresBatch for batch-fetched data.
 */
export function DeliveryScoreBadge({ onTimePct, compact = true }: Props) {
  if (onTimePct <= 0) return null;

  if (compact) {
    return (
      <Badge variant="secondary" className="text-[10px] bg-success/10 text-success border-0 gap-1">
        <Truck size={10} />
        On time {onTimePct}%
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-success">
      <Truck size={12} />
      <span className="font-medium">{onTimePct}% on-time delivery</span>
    </div>
  );
}
