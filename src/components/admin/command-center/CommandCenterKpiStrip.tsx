// @ts-nocheck
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CommandCenterSnapshot } from '@/hooks/useCommandCenter';

type KpiKey =
  | 'stores'
  | 'pending_stores'
  | 'live_listings'
  | 'orders_today'
  | 'open_disputes'
  | 'attention';

type KpiCard = {
  key: KpiKey;
  label: string;
  value: number;
  hint?: string;
  color: string;
};

function buildCards(snapshot: CommandCenterSnapshot): KpiCard[] {
  return [
    {
      key: 'stores',
      label: 'Stores',
      value: snapshot.sellers?.total ?? 0,
      hint: `${snapshot.sellers?.ready_surface ?? 0} approved & open`,
      color: 'bg-violet-500',
    },
    {
      key: 'pending_stores',
      label: 'Pending stores',
      value: snapshot.sellers?.pending ?? 0,
      color: 'bg-amber-500',
    },
    {
      key: 'live_listings',
      label: 'Live listings',
      value: snapshot.listings?.live_products ?? 0,
      hint: `${snapshot.listings?.pending_products ?? 0} awaiting approval`,
      color: 'bg-emerald-500',
    },
    {
      key: 'orders_today',
      label: 'Orders today',
      value: snapshot.orders?.today ?? 0,
      hint: `${snapshot.orders?.week ?? 0} this week`,
      color: 'bg-blue-500',
    },
    {
      key: 'open_disputes',
      label: 'Open disputes',
      value: snapshot.disputes?.open ?? 0,
      color: 'bg-red-500',
    },
    {
      key: 'attention',
      label: 'Needs attention',
      value:
        (snapshot.attention?.pending_store_verifications ?? 0) +
        (snapshot.attention?.pending_product_approvals ?? 0) +
        (snapshot.attention?.open_refunds ?? 0) +
        (snapshot.attention?.payment_pending_orders ?? 0),
      color: 'bg-orange-500',
    },
  ];
}

export function CommandCenterKpiStrip({
  snapshot,
  activeKey,
  onSelect,
}: {
  snapshot: CommandCenterSnapshot;
  activeKey?: KpiKey | null;
  onSelect: (key: KpiKey) => void;
}) {
  const cards = buildCards(snapshot);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          onClick={() => onSelect(card.key)}
          className="text-left"
        >
          <Card
            className={cn(
              'border-0 shadow-[var(--shadow-card)] rounded-2xl transition-all',
              activeKey === card.key && 'ring-2 ring-primary/40',
            )}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', card.color)}>
                <span className="text-white text-sm font-extrabold tabular-nums">
                  {card.value > 99 ? '99+' : card.value}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-xl font-extrabold tabular-nums leading-none">{card.value}</p>
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mt-1">
                  {card.label}
                </p>
                {card.hint && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{card.hint}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}

export type { KpiKey };
