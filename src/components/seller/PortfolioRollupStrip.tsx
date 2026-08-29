// @ts-nocheck
import { LayoutGrid, Hand, TrendingUp } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';

interface PortfolioRollupStripProps {
  storeCount: number;
  actionNeeded: number;
  settledTotal: number;
  settledToday: number;
}

/** Clearly labeled multi-store aggregate — never shown without “All stores”. */
export function PortfolioRollupStrip({
  storeCount,
  actionNeeded,
  settledTotal,
  settledToday,
}: PortfolioRollupStripProps) {
  const { formatPrice } = useCurrency();

  return (
    <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-background to-accent/5 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
            <LayoutGrid size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">
              All stores
            </p>
            <p className="text-sm font-semibold truncate">
              Portfolio · {storeCount} store{storeCount === 1 ? '' : 's'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Summed sales and action-needed across stores you own
            </p>
          </div>
        </div>
      </div>

      <SellerSwitcher />

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-background/70 border border-border/60 p-2.5 text-center">
          <Hand size={14} className="mx-auto text-warning mb-0.5" />
          <p className="text-base font-bold tabular-nums leading-tight">{actionNeeded}</p>
          <p className="text-[10px] text-muted-foreground">Action needed</p>
        </div>
        <div className="rounded-lg bg-background/70 border border-border/60 p-2.5 text-center">
          <TrendingUp size={14} className="mx-auto text-success mb-0.5" />
          <p className="text-base font-bold tabular-nums text-success leading-tight">
            {formatPrice(settledToday)}
          </p>
          <p className="text-[10px] text-muted-foreground">Settled today</p>
        </div>
        <div className="rounded-lg bg-background/70 border border-border/60 p-2.5 text-center">
          <TrendingUp size={14} className="mx-auto text-success mb-0.5" />
          <p className="text-base font-bold tabular-nums text-success leading-tight">
            {formatPrice(settledTotal)}
          </p>
          <p className="text-[10px] text-muted-foreground">Settled all-time</p>
        </div>
      </div>
    </div>
  );
}
