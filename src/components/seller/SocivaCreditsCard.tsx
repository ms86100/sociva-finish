import { Link } from 'react-router-dom';
import { Coins, ChevronRight } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { Button } from '@/components/ui/button';
import {
  SELLER_CREDITS_EXHAUSTED,
  SELLER_CREDITS_ROUTE,
  type SellerCreditSummary,
} from '@/lib/sellerCredits';

export function SocivaCreditsCard({
  summary,
  allStores = false,
  compact = false,
}: {
  summary?: SellerCreditSummary | null;
  allStores?: boolean;
  compact?: boolean;
}) {
  const { formatPrice } = useCurrency();
  const available = summary?.available ?? 0;
  const exhausted = available <= 0;

  return (
    <Link to={SELLER_CREDITS_ROUTE}>
      <div className={compact ? 'rounded-lg border bg-card px-3 py-2.5' : 'rounded-xl border bg-card p-4'}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Coins size={compact ? 16 : 20} className="text-primary shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-sm">
                Sociva Credits{allStores ? ' · All stores' : ''}
              </p>
              <p className="text-[11px] text-muted-foreground">Available prepaid platform usage</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-lg font-bold tabular-nums">{formatPrice(available)}</p>
            <ChevronRight size={16} className="text-muted-foreground" />
          </div>
        </div>
        {exhausted && (
          <p className="text-xs text-destructive mt-2">
            {summary?.spendEnabled
              ? SELLER_CREDITS_EXHAUSTED
              : 'Buyers cannot find your store in search until you recharge Sociva Credits.'}
          </p>
        )}
        <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
          <span>Reserved {formatPrice(summary?.reserved || 0)}</span>
          <span>Used this month {formatPrice(summary?.usedThisMonth || 0)}</span>
          <span>
            Orders {summary?.ordersThisMonth || 0} · Enquiries {summary?.enquiriesThisMonth || 0} · Bookings {summary?.bookingsThisMonth || 0}
          </span>
        </div>
        <Button size="sm" className="mt-3 h-8 text-xs" variant={exhausted ? 'default' : 'outline'}>
          Recharge
        </Button>
      </div>
    </Link>
  );
}
