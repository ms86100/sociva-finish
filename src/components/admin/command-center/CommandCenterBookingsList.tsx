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
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CommandCenterBookingRow } from '@/hooks/useCommandCenter';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
};

export function CommandCenterBookingsList({
  rows,
  total,
  page,
  onPageChange,
  status,
  search,
  onStatusChange,
  onSearchChange,
  isLoading,
}: {
  rows: CommandCenterBookingRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  status: string;
  search: string;
  onStatusChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  isLoading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search booking, buyer, service…"
          className="h-9 max-w-xs rounded-xl text-sm"
        />
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="h-9 w-36 rounded-xl text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="confirmed">confirmed</SelectItem>
            <SelectItem value="completed">completed</SelectItem>
            <SelectItem value="cancelled">cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} bookings</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No bookings match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((booking) => (
            <Card
              key={booking.booking_id}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Calendar size={16} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold text-muted-foreground">
                          #{booking.booking_id.slice(0, 8)}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize',
                            STATUS_COLORS[booking.status] || 'bg-muted text-muted-foreground',
                          )}
                        >
                          {booking.status}
                        </span>
                      </div>
                      <p className="text-sm font-semibold mt-1">
                        {booking.product_name || 'Service'} · {booking.seller_name || 'Seller'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {booking.buyer_name || 'Buyer'}
                        {booking.buyer_phone ? ` · ${booking.buyer_phone}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(booking.booking_date), 'dd MMM yyyy')} · {booking.start_time}–{booking.end_time}
                        {booking.location_type ? ` · ${booking.location_type}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {booking.order_id ? (
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-xl text-xs">
                        <Link to={`/orders/${booking.order_id}`}>Order</Link>
                      </Button>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">
                        No order
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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
