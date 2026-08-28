// @ts-nocheck
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CommandCenterOrderRow } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { PAYMENT_STATUS_LABELS } from '@/types/Database';

const PAGE_SIZE = 25;

export function CommandCenterOrdersList({
  rows,
  total,
  page,
  onPageChange,
  status,
  paymentStatus,
  search,
  onStatusChange,
  onPaymentStatusChange,
  onSearchChange,
  isLoading,
}: {
  rows: CommandCenterOrderRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  status: string;
  paymentStatus: string;
  search: string;
  onStatusChange: (value: string) => void;
  onPaymentStatusChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  isLoading?: boolean;
}) {
  const { formatPrice } = useCurrency();
  const { getOrderStatus } = useStatusLabels();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search order, buyer, seller…"
          className="h-9 max-w-xs rounded-xl text-sm"
        />
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="h-9 w-36 rounded-xl text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="placed">placed</SelectItem>
            <SelectItem value="accepted">accepted</SelectItem>
            <SelectItem value="preparing">preparing</SelectItem>
            <SelectItem value="ready">ready</SelectItem>
            <SelectItem value="delivered">delivered</SelectItem>
            <SelectItem value="cancelled">cancelled</SelectItem>
            <SelectItem value="enquired">enquired</SelectItem>
            <SelectItem value="quoted">quoted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={paymentStatus} onValueChange={onPaymentStatusChange}>
          <SelectTrigger className="h-9 w-36 rounded-xl text-xs">
            <SelectValue placeholder="Payment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All payment</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="payment_pending">payment_pending</SelectItem>
            <SelectItem value="paid">paid</SelectItem>
            <SelectItem value="failed">failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} orders</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No orders match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((order) => {
            const statusInfo = getOrderStatus(order.status);
            const payInfo =
              PAYMENT_STATUS_LABELS[order.payment_status as keyof typeof PAYMENT_STATUS_LABELS] || {
                label: order.payment_status,
                color: 'bg-muted text-muted-foreground',
              };

            return (
              <Card
                key={order.order_id}
                className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold text-muted-foreground">
                          #{order.order_id.slice(0, 8)}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                            statusInfo.color,
                          )}
                        >
                          {statusInfo.label}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                            payInfo.color,
                          )}
                        >
                          {payInfo.label}
                        </span>
                      </div>
                      <p className="text-sm font-semibold mt-1">
                        {order.buyer_name || 'Buyer'} → {order.seller_name || 'Seller'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {order.society_name || 'Society'} · {format(new Date(order.created_at), 'dd MMM, h:mm a')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums">{formatPrice(order.total_amount)}</p>
                      <Button asChild size="sm" variant="outline" className="h-8 mt-2 rounded-xl text-xs">
                        <Link to={`/orders/${order.order_id}`}>Open</Link>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={page <= 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft size={14} className="mr-1" />
            Prev
          </Button>
          <Badge variant="secondary" className="text-xs">
            Page {page + 1} / {totalPages}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={page + 1 >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
            <ChevronRight size={14} className="ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
