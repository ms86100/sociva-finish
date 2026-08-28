// @ts-nocheck
import { format } from 'date-fns';
import {
  Activity,
  Package,
  ShoppingBag,
  Store,
  Calendar,
  AlertTriangle,
  Star,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CommandCenterActivityRow } from '@/hooks/useCommandCenter';

const PAGE_SIZE = 50;

const EVENT_META: Record<string, { label: string; icon: typeof Activity; color: string }> = {
  order_placed: { label: 'Order placed', icon: ShoppingBag, color: 'text-blue-600 bg-blue-500/10' },
  store_registered: { label: 'Store registered', icon: Store, color: 'text-violet-600 bg-violet-500/10' },
  product_listed: { label: 'Product listed', icon: Package, color: 'text-emerald-600 bg-emerald-500/10' },
  booking_created: { label: 'Booking created', icon: Calendar, color: 'text-cyan-600 bg-cyan-500/10' },
  dispute_raised: { label: 'Dispute raised', icon: AlertTriangle, color: 'text-red-600 bg-red-500/10' },
  review_posted: { label: 'Review posted', icon: Star, color: 'text-amber-600 bg-amber-500/10' },
};

export function CommandCenterActivityFeed({
  rows,
  total,
  page,
  onPageChange,
  eventType,
  onEventTypeChange,
  onSelectSeller,
  isLoading,
}: {
  rows: CommandCenterActivityRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  eventType: string;
  onEventTypeChange: (value: string) => void;
  onSelectSeller?: (sellerId: string) => void;
  isLoading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={eventType} onValueChange={onEventTypeChange}>
          <SelectTrigger className="h-9 w-48 rounded-xl text-xs">
            <SelectValue placeholder="Event type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All events</SelectItem>
            <SelectItem value="order_placed">Orders</SelectItem>
            <SelectItem value="store_registered">Store registrations</SelectItem>
            <SelectItem value="product_listed">Product listings</SelectItem>
            <SelectItem value="booking_created">Bookings</SelectItem>
            <SelectItem value="dispute_raised">Disputes</SelectItem>
            <SelectItem value="review_posted">Reviews</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} events</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No activity in this window.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((event) => {
            const meta = EVENT_META[event.event_type] || {
              label: event.event_type,
              icon: Activity,
              color: 'text-muted-foreground bg-muted',
            };
            const Icon = meta.icon;

            return (
              <Card
                key={`${event.event_type}-${event.entity_id}-${event.occurred_at}`}
                className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
              >
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.color.split(' ').slice(1).join(' ')}`}>
                      <Icon size={15} className={meta.color.split(' ')[0]} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold">{meta.label}</p>
                        {event.detail && (
                          <Badge variant="outline" className="text-[10px] h-5 capitalize">
                            {event.detail}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {event.actor_name || '—'}
                        {event.target_name ? ` → ${event.target_name}` : ''}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {format(new Date(event.occurred_at), 'dd MMM yyyy, h:mm a')}
                      </p>
                    </div>
                    {event.seller_id && onSelectSeller && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-xl text-xs shrink-0"
                        onClick={() => onSelectSeller(event.seller_id!)}
                      >
                        Store
                      </Button>
                    )}
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
