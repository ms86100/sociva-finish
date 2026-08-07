// @ts-nocheck
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useCheckoutGroup } from '@/hooks/useCheckoutGroup';
import { useCurrency } from '@/hooks/useCurrency';
import { buyerStoreStatusLabel, sumOrderAmounts } from '@/lib/checkout-groups';
import { resolveOrderProgress } from '@/lib/orderProgressStages';
import { OrderProgressRail } from '@/components/order/OrderProgressRail';
import { ArrowLeft, ChevronRight, Package, Store } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';

export default function CheckoutDetailPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const { data, isLoading, error } = useCheckoutGroup(groupId, user?.id);

  const orders = data?.orders || [];
  const group = data?.group;
  const total = group?.total_amount != null ? Number(group.total_amount) : sumOrderAmounts(orders);

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3.5 flex items-center gap-3">
          <Link
            to="/orders"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 className="text-lg font-bold text-foreground">Checkout</h1>
        </div>
      </SafeHeader>

      <div className="px-4 pb-8 space-y-4">
        {isLoading ? (
          <div className="space-y-3 pt-2">
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
          </div>
        ) : error || orders.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <Store className="mx-auto text-muted-foreground" size={28} />
            <p className="text-sm text-muted-foreground">Checkout not found</p>
            <Button asChild variant="secondary" size="sm">
              <Link to="/orders">Back to orders</Link>
            </Button>
          </div>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-border/60 bg-card/80 p-4 space-y-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">
                    Purchase
                  </p>
                  <h1 className="text-lg font-semibold mt-0.5">
                    {orders.length} store{orders.length === 1 ? '' : 's'}
                  </h1>
                  <p className="text-xs text-muted-foreground mt-1">
                    {group?.created_at
                      ? format(new Date(group.created_at), 'MMM d, yyyy · h:mm a')
                      : format(new Date(orders[0].created_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{formatPrice(total)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {(group?.payment_method || orders[0]?.payment_type) === 'cod'
                      ? 'Cash on delivery'
                      : (group?.payment_method || orders[0]?.payment_type) === 'wallet'
                        ? 'Sociva Credit'
                        : group?.payment_status === 'paid' || orders.every((o) => o.payment_status === 'paid')
                          ? 'Paid online'
                          : 'Payment'}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Each store accepts and fulfills independently. Track progress per store below.
              </p>
            </motion.div>

            <div className="space-y-3">
              {orders.map((order) => {
                const label = buyerStoreStatusLabel(
                  order.status,
                  order.payment_status,
                  { failureOwner: order.failure_owner, rejectionReason: order.rejection_reason },
                );
                const progress = resolveOrderProgress({
                  status: order.status,
                  fulfillmentType: order.fulfillment_type,
                });
                const items = order.items || [];
                const name = order.seller?.business_name || 'Store';
                const img = items[0]?.product_image || order.seller?.cover_image_url;

                return (
                  <Link
                    key={order.id}
                    to={`/orders/${order.id}`}
                    className="block rounded-2xl border border-border/60 bg-card/80 p-3 space-y-3 hover:border-primary/30 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-muted shrink-0 flex items-center justify-center">
                        {img ? (
                          <img src={img} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package size={18} className="text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h2 className="text-sm font-semibold truncate">{name}</h2>
                          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {items.length} item{items.length === 1 ? '' : 's'} · {formatPrice(order.total_amount)}
                        </p>
                        <p className="text-xs font-medium mt-1">{label}</p>
                      </div>
                    </div>

                    {progress.kind === 'stages' ? (
                      <OrderProgressRail
                        stages={progress.stages}
                        currentIndex={progress.stageIndex}
                        hint={progress.subtext}
                        title={null}
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground px-1">{progress.label}</p>
                    )}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
