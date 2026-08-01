// @ts-nocheck
import { Link } from 'react-router-dom';
import { TrendingUp, ChevronRight } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { cn } from '@/lib/utils';

interface EarningsSummaryProps {
  todayEarnings: number;
  weekEarnings: number;
  totalEarnings: number;
  compact?: boolean;
}

export function EarningsSummary({ todayEarnings, weekEarnings, totalEarnings, compact = false }: EarningsSummaryProps) {
  const { formatPrice } = useCurrency();

  if (compact) {
    return (
      <Link to="/seller/earnings">
        <div className="bg-gradient-to-r from-success/10 to-success/5 rounded-lg px-3 py-2 flex items-center justify-between mt-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-success shrink-0" size={14} />
            <span className="text-xs text-muted-foreground">Earnings</span>
          </div>
          <div className="flex items-center gap-3 text-xs tabular-nums">
            <span>Today <strong className="text-success">{formatPrice(todayEarnings)}</strong></span>
            <span className="text-muted-foreground">|</span>
            <span>Week <strong className="text-success">{formatPrice(weekEarnings)}</strong></span>
            <span className="text-muted-foreground">|</span>
            <span>Total <strong className="text-success">{formatPrice(totalEarnings)}</strong></span>
          </div>
          <ChevronRight className="text-muted-foreground shrink-0" size={14} />
        </div>
      </Link>
    );
  }

  return (
    <Link to="/seller/earnings">
      <div className="bg-gradient-to-r from-success/10 to-success/5 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="text-success" size={20} />
            <h3 className="font-semibold">Earnings Summary</h3>
          </div>
          <ChevronRight className="text-muted-foreground" size={18} />
        </div>
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
      </div>
    </Link>
  );
}
