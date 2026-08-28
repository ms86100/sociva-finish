// @ts-nocheck
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Star, Store, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useCommandCenterStore360 } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';

const VERIFICATION_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  suspended: 'bg-orange-100 text-orange-800',
  draft: 'bg-muted text-muted-foreground',
};

export function CommandCenterStore360Sheet({
  sellerId,
  open,
  onOpenChange,
  onViewOrders,
  onViewProducts,
}: {
  sellerId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onViewOrders?: (sellerId: string) => void;
  onViewProducts?: (sellerId: string) => void;
}) {
  const { formatPrice } = useCurrency();
  const storeQuery = useCommandCenterStore360(sellerId);
  const store = storeQuery.data;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-bold">
            <Store size={18} />
            Store 360
          </SheetTitle>
        </SheetHeader>

        {storeQuery.isLoading ? (
          <div className="space-y-3 mt-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : store ? (
          <div className="space-y-4 mt-4 pb-8">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold">{store.business_name}</h2>
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize',
                    VERIFICATION_COLORS[store.verification_status] || 'bg-muted',
                  )}
                >
                  {store.verification_status}
                </span>
                {store.vacation_mode && <Badge variant="outline">Vacation</Badge>}
                {!store.is_available && <Badge variant="secondary">Unavailable</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {store.owner_name || 'Owner'} · {store.owner_phone || '—'}
              </p>
              <p className="text-xs text-muted-foreground">
                {store.society_name || 'No society'} · joined{' '}
                {format(new Date(store.created_at), 'dd MMM yyyy')}
              </p>
              {store.rating != null && (
                <p className="text-xs mt-1 flex items-center gap-1">
                  <Star size={12} className="text-amber-500 fill-amber-500" />
                  {Number(store.rating).toFixed(1)} ({store.total_reviews ?? 0} reviews)
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Orders (30d)" value={store.activity?.orders_30d ?? 0} />
              <Metric label="Completed" value={store.activity?.orders_completed ?? 0} />
              <Metric label="Live listings" value={store.listings?.live ?? 0} />
              <Metric label="Pending listings" value={store.listings?.pending ?? 0} />
              <Metric label="Open disputes" value={store.quality?.open_disputes ?? 0} />
              <Metric label="Unanswered enquiries" value={store.activity?.enquiries_unanswered ?? 0} />
            </div>

            <div className="flex gap-2 flex-wrap">
              {onViewOrders && (
                <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={() => onViewOrders(store.seller_id)}>
                  View orders
                </Button>
              )}
              {onViewProducts && (
                <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={() => onViewProducts(store.seller_id)}>
                  View products
                </Button>
              )}
            </div>

            {store.recent_orders?.length > 0 && (
              <Section title="Recent orders">
                {store.recent_orders.map((o) => (
                  <Link
                    key={o.order_id}
                    to={`/orders/${o.order_id}`}
                    className="block rounded-xl px-3 py-2 hover:bg-muted/50 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">#{o.order_id.slice(0, 8)}</span>
                    <span className="ml-2 capitalize">{o.status}</span>
                    <span className="float-right font-semibold">{formatPrice(o.total_amount)}</span>
                  </Link>
                ))}
              </Section>
            )}

            {store.recent_products?.length > 0 && (
              <Section title="Recent products">
                {store.recent_products.map((p) => (
                  <div key={p.product_id} className="rounded-xl px-3 py-2 text-sm">
                    <p className="font-semibold truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {p.approval_status} · {formatPrice(p.price)}
                    </p>
                  </div>
                ))}
              </Section>
            )}

            {store.recent_reviews?.length > 0 && (
              <Section title="Recent reviews">
                {store.recent_reviews.map((r) => (
                  <div key={r.review_id} className="rounded-xl px-3 py-2 text-sm">
                    <p className="flex items-center gap-1">
                      <Star size={12} className="text-amber-500 fill-amber-500" />
                      {r.rating} · {r.buyer_name || 'Buyer'}
                    </p>
                    {r.comment && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.comment}</p>}
                  </div>
                ))}
              </Section>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground mt-4">Store not found.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
