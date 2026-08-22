// @ts-nocheck
import { Link } from 'react-router-dom';
import { CalendarClock, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useScheduledOrders } from '@/hooks/useScheduledOrders';
import { ScheduledOrderCountdown } from '@/components/orders/ScheduledOrderCountdown';
import { formatScheduledDateTime } from '@/lib/scheduled-orders';
import { motion } from 'framer-motion';
import { cardEntrance, staggerContainer } from '@/lib/motion-variants';

interface BuyerUpcomingOrdersProps {
  buyerId: string;
}

export function BuyerUpcomingOrders({ buyerId }: BuyerUpcomingOrdersProps) {
  const { data, isLoading } = useScheduledOrders({ buyerId });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  const grouped = data?.grouped ?? [];
  if (grouped.length === 0) {
    return (
      <div className="text-center py-10 text-sm text-muted-foreground">
        <CalendarClock className="mx-auto mb-2 opacity-50" size={28} />
        No upcoming scheduled orders
      </div>
    );
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-4">
      {grouped.map((g) => (
        <div key={g.date}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{g.label}</p>
          <div className="space-y-2">
            {g.orders.map((order) => (
              <motion.div key={order.id} variants={cardEntrance}>
                <Link
                  to={`/orders/${order.id}`}
                  className="block bg-card/80 border border-border/50 rounded-2xl p-3 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        Order #{order.id!.slice(-6).toUpperCase()}
                        {order.seller?.business_name ? ` · ${order.seller.business_name}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{formatScheduledDateTime(order)}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">Scheduled order</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <ScheduledOrderCountdown order={order} size="sm" />
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </motion.div>
  );
}
