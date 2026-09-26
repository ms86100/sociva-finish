// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CommandCenterSnapshot } from '@/hooks/useCommandCenter';
import {
  COMMAND_CENTER_BUCKETS,
  type CommandCenterBucketId,
} from '@/lib/commandCenterBuckets';

type KpiKey = CommandCenterBucketId;

const CARD_COLOR: Record<KpiKey, string> = {
  pending_stores: 'bg-amber-500',
  pending_products: 'bg-amber-500',
  orders_today: 'bg-blue-500',
  unanswered_enquiries: 'bg-orange-500',
  open_disputes: 'bg-red-500',
  payment_waiting: 'bg-violet-500',
};

export function CommandCenterKpiStrip({
  snapshot,
  activeKey,
  onSelect,
}: {
  snapshot: CommandCenterSnapshot;
  activeKey?: KpiKey | null;
  onSelect: (key: KpiKey) => void;
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {COMMAND_CENTER_BUCKETS.map((card) => {
        const value = snapshot.buckets?.[card.id] ?? 0;
        return (
          <button
            key={card.id}
            type="button"
            onClick={() => onSelect(card.id)}
            className="text-left"
          >
            <Card
              className={cn(
                'border-0 shadow-[var(--shadow-card)] rounded-2xl transition-all',
                activeKey === card.id && 'ring-2 ring-primary/40',
              )}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', CARD_COLOR[card.id])}>
                  <span className="text-white text-sm font-extrabold tabular-nums">
                    {value > 99 ? '99+' : value}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-extrabold tabular-nums leading-none">{value}</p>
                  <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mt-1">
                    {card.label}
                  </p>
                </div>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}

export type { KpiKey };
