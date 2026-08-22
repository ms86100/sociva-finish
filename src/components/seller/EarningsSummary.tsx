// @ts-nocheck
import { Link } from 'react-router-dom';
import { TrendingUp, ChevronRight, AlertTriangle } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { cn } from '@/lib/utils';

interface EarningsSummaryProps {
  todayEarnings: number;
  weekEarnings: number;
  totalEarnings: number;
  available?: number;
  pending?: number;
  paidOut?: number;
  compact?: boolean;
  /** When true, numbers are portfolio-summed — must stay labeled. */
  allStores?: boolean;
  kpiError?: boolean;
  financeError?: boolean;
}

export function EarningsSummary({
  todayEarnings,
  weekEarnings,
  totalEarnings,
  available = 0,
  pending = 0,
  paidOut = 0,
  compact = false,
  allStores = false,
  kpiError = false,
  financeError = false,
}: EarningsSummaryProps) {
  const { formatPrice } = useCurrency();
  const gmvTitle = allStores ? 'Settled GMV · All stores' : 'Settled GMV';

  if (compact) {
    return (
      <Link to="/seller/wallet">
        <div className="bg-gradient-to-r from-success/10 to-success/5 rounded-lg px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="text-success shrink-0" size={14} />
              <span className="text-xs text-muted-foreground truncate">{gmvTitle}</span>
            </div>
            {kpiError ? (
              <span className="text-[11px] text-destructive flex items-center gap-1">
                <AlertTriangle size={12} /> Totals unavailable
              </span>
            ) : (
              <div className="flex items-center gap-2 text-xs tabular-nums">
                <span>Today <strong className="text-success">{formatPrice(todayEarnings)}</strong></span>
                <span className="text-muted-foreground">|</span>
                <span>Week <strong className="text-success">{formatPrice(weekEarnings)}</strong></span>
                <span className="text-muted-foreground">|</span>
                <span>All-time <strong className="text-success">{formatPrice(totalEarnings)}</strong></span>
              </div>
            )}
            <ChevronRight className="text-muted-foreground shrink-0" size={14} />
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
            <span className="text-muted-foreground">Seller payable</span>
            {financeError ? (
              <span className="text-destructive">Wallet totals unavailable</span>
            ) : (
              <span className="flex items-center gap-2">
                <span>Available <strong>{formatPrice(available)}</strong></span>
                <span className="text-muted-foreground">|</span>
                <span>Pending <strong>{formatPrice(pending)}</strong></span>
                <span className="text-muted-foreground">|</span>
                <span>Paid out <strong>{formatPrice(paidOut)}</strong></span>
              </span>
            )}
          </div>
        </div>
      </Link>
    );
  }

  return (
    <Link to="/seller/wallet">
      <div className="bg-gradient-to-r from-success/10 to-success/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-success" size={20} />
            <h3 className="font-semibold">{allStores ? 'Settled GMV · All stores' : 'Settled GMV'}</h3>
          </div>
          <ChevronRight className="text-muted-foreground" size={18} />
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">
          Completed sales value after refunds. Not the same as withdrawable earnings.
        </p>
        {kpiError ? (
          <p className={cn('text-sm text-destructive mb-3')}>Settled GMV could not be loaded.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="text-lg font-bold text-success tabular-nums">{formatPrice(todayEarnings)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">This Week</p>
              <p className="text-lg font-bold text-success tabular-nums">{formatPrice(weekEarnings)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">All Time</p>
              <p className="text-lg font-bold text-success tabular-nums">{formatPrice(totalEarnings)}</p>
            </div>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mt-3">
          {financeError ? (
            <p className="col-span-3 text-sm text-destructive">Seller payable totals could not be loaded.</p>
          ) : (
            <>
              <div className="bg-background/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Available</p>
                <p className="text-sm font-bold tabular-nums">{formatPrice(available)}</p>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="text-sm font-bold tabular-nums">{formatPrice(pending)}</p>
              </div>
              <div className="bg-background/50 rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground">Paid out</p>
                <p className="text-sm font-bold tabular-nums">{formatPrice(paidOut)}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
