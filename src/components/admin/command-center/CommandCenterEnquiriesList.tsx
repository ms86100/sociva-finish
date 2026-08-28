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
import { ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import type { CommandCenterEnquiryRow } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';
import { useStatusLabels } from '@/hooks/useStatusLabels';

const PAGE_SIZE = 25;

export function CommandCenterEnquiriesList({
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
  rows: CommandCenterEnquiryRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  status: string;
  search: string;
  onStatusChange: (value: string) => void;
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
          placeholder="Search enquiry, buyer, store…"
          className="h-9 max-w-xs rounded-xl text-sm"
        />
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="h-9 w-36 rounded-xl text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="enquired">enquired</SelectItem>
            <SelectItem value="quoted">quoted</SelectItem>
            <SelectItem value="placed">placed</SelectItem>
            <SelectItem value="cancelled">cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} enquiries</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No enquiries match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((enquiry) => {
            const statusInfo = getOrderStatus(enquiry.status);

            return (
              <Card
                key={enquiry.enquiry_id}
                className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
              >
                <CardContent className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center shrink-0">
                        <MessageSquare size={16} className="text-orange-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono font-bold text-muted-foreground">
                            #{enquiry.enquiry_id.slice(0, 8)}
                          </span>
                          <span
                            className={cn(
                              'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                              statusInfo.color,
                            )}
                          >
                            {statusInfo.label}
                          </span>
                          {enquiry.order_type && (
                            <Badge variant="outline" className="text-[10px] h-5 capitalize">
                              {enquiry.order_type}
                            </Badge>
                          )}
                          {enquiry.has_conversation && (
                            <Badge variant="secondary" className="text-[10px] h-5">
                              conversation
                            </Badge>
                          )}
                          {enquiry.seller_responded ? (
                            <Badge className="text-[10px] h-5 bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                              responded
                            </Badge>
                          ) : enquiry.status === 'enquired' ? (
                            <Badge variant="destructive" className="text-[10px] h-5">
                              unanswered
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm font-semibold mt-1">
                          {enquiry.buyer_name || 'Buyer'} → {enquiry.seller_name || 'Seller'}
                        </p>
                        {enquiry.product_summary && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{enquiry.product_summary}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {enquiry.society_name || 'Society'} · {format(new Date(enquiry.created_at), 'dd MMM, h:mm a')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular-nums">{formatPrice(enquiry.total_amount)}</p>
                      <Button asChild size="sm" variant="outline" className="h-8 mt-2 rounded-xl text-xs">
                        <Link to={`/orders/${enquiry.enquiry_id}`}>Open</Link>
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
