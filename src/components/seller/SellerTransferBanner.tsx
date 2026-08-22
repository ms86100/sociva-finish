// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, X } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';
import { useSellerFinancialActivity } from '@/hooks/queries/useSellerFinancial';

const DISMISS_KEY = 'sociva.seller-transfer-banner.dismissed';

function dismissedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function SellerTransferBanner({
  sellerId,
  portfolioIds,
  available,
}: {
  sellerId: string | null | undefined;
  portfolioIds?: string[] | null;
  available: number;
}) {
  const { formatPrice } = useCurrency();
  const { data: activity = [] } = useSellerFinancialActivity(sellerId, portfolioIds);
  const [hidden, setHidden] = useState(false);

  const latest = useMemo(() => {
    const seen = new Set(dismissedIds());
    return (activity as any[]).find((row) => {
      const transfer = row?.metadata?.provider_transfer_id || row?.metadata?.offline_transfer_ref || row?.metadata?.transfer_ref;
      const transferred =
        (row?.type === 'settlement' && row?.status === 'settled' && transfer) ||
        (row?.type === 'withdrawal' && ['transferred', 'paid'].includes(row?.status) && transfer);
      return transferred && row?.id && !seen.has(String(row.id));
    });
  }, [activity]);

  if (hidden || !latest) return null;
  const transfer = latest.metadata?.provider_transfer_id || latest.metadata?.offline_transfer_ref || latest.metadata?.transfer_ref;
  const method = latest.metadata?.transfer_method || latest.metadata?.method || (latest.metadata?.offline_transfer_ref ? 'Offline UPI/bank' : 'Razorpay');
  const when = latest.event_at ? new Date(latest.event_at) : null;

  const dismiss = () => {
    const next = [...dismissedIds(), String(latest.id)];
    localStorage.setItem(DISMISS_KEY, JSON.stringify(next.slice(-20)));
    setHidden(true);
  };

  return (
    <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2.5 flex items-start gap-2">
      <Banknote size={16} className="text-success mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {formatPrice(Number(latest.amount) || 0)} transferred
        </p>
        <p className="text-[11px] text-muted-foreground">
          {method}
          {transfer ? ` · Ref ${transfer}` : ''}
          {when ? ` · ${when.toLocaleString()}` : ''}
          {' · '}Available now {formatPrice(available)}
        </p>
        <Link to="/seller/wallet" className="text-[11px] text-primary font-medium">
          View wallet
        </Link>
      </div>
      <button type="button" onClick={dismiss} className="p-1 text-muted-foreground" aria-label="Dismiss transfer notice">
        <X size={14} />
      </button>
    </div>
  );
}
