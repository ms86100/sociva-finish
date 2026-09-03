import { Link } from 'react-router-dom';
import { buyerStoreStatusLabel } from '@/lib/checkout-groups';
import { useCurrency } from '@/hooks/useCurrency';
import { ChevronRight, Store } from 'lucide-react';

type Sibling = {
  id: string;
  status: string;
  payment_status?: string | null;
  total_amount: number;
  failure_owner?: string | null;
  rejection_reason?: string | null;
  seller?: { business_name?: string | null } | null;
};

/** Compact strip of sibling seller orders within the same checkout. */
export function CheckoutSiblingsStrip({
  siblings,
  currentOrderId,
  checkoutGroupId,
}: {
  siblings: Sibling[];
  currentOrderId: string;
  checkoutGroupId?: string | null;
}) {
  const { formatPrice } = useCurrency();
  if (!siblings || siblings.length < 2) return null;

  const others = siblings.filter((s) => s.id !== currentOrderId);
  if (others.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Store size={14} className="text-primary" />
          <p className="text-xs font-semibold">Also in this checkout</p>
        </div>
        {checkoutGroupId && !String(checkoutGroupId).startsWith('soft:') ? (
          <Link
            to={`/checkouts/${checkoutGroupId}`}
            className="text-[11px] text-primary font-medium inline-flex items-center gap-0.5"
          >
            View all <ChevronRight size={12} />
          </Link>
        ) : null}
      </div>
      <div className="space-y-1.5">
        {siblings.map((s) => {
          const label = buyerStoreStatusLabel(s.status, s.payment_status, {
            failureOwner: s.failure_owner,
            rejectionReason: s.rejection_reason,
          });
          const isCurrent = s.id === currentOrderId;
          const seller = Array.isArray(s.seller) ? s.seller[0] : s.seller;
          const inner = (
            <div
              className={`flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-xs ${
                isCurrent ? 'bg-primary/10 border border-primary/20' : 'bg-muted/40'
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">
                  {seller?.business_name || 'Store'}
                  {isCurrent ? ' · this store' : ''}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
              </div>
              <span className="font-medium shrink-0">{formatPrice(s.total_amount)}</span>
            </div>
          );
          if (isCurrent) return <div key={s.id}>{inner}</div>;
          return (
            <Link key={s.id} to={`/orders/${s.id}`} className="block">
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
