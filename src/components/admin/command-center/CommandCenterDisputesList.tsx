// @ts-nocheck
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CommandCenterDisputeRow } from '@/hooks/useCommandCenter';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-800',
  acknowledged: 'bg-amber-100 text-amber-800',
  in_review: 'bg-amber-100 text-amber-800',
  resolved: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-muted text-muted-foreground',
  rejected: 'bg-red-100 text-red-800',
};

export function CommandCenterDisputesList({
  rows,
  total,
  page,
  onPageChange,
  status,
  search,
  onStatusChange,
  onSearchChange,
  onSelectSeller,
  isLoading,
}: {
  rows: CommandCenterDisputeRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  status: string;
  search: string;
  onStatusChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onSelectSeller?: (sellerId: string) => void;
  isLoading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search dispute, store…"
          className="h-9 max-w-xs rounded-xl text-sm"
        />
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">open</SelectItem>
            <SelectItem value="acknowledged">acknowledged</SelectItem>
            <SelectItem value="in_review">in_review</SelectItem>
            <SelectItem value="resolved">resolved</SelectItem>
            <SelectItem value="closed">closed</SelectItem>
            <SelectItem value="rejected">rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} disputes & tickets</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No disputes match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((dispute) => (
            <Card
              key={`${dispute.dispute_kind}-${dispute.dispute_id}`}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                      <AlertTriangle size={16} className="text-red-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-mono font-bold text-muted-foreground">
                          #{dispute.dispute_id.slice(0, 8)}
                        </span>
                        <Badge variant="outline" className="text-[10px] h-5 capitalize">
                          {dispute.dispute_kind.replace('_', ' ')}
                        </Badge>
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize',
                            STATUS_COLORS[dispute.status] || 'bg-muted text-muted-foreground',
                          )}
                        >
                          {dispute.status}
                        </span>
                      </div>
                      <p className="text-sm font-semibold mt-1">
                        {dispute.seller_name || 'Store'} · {dispute.buyer_name || 'Buyer'}
                      </p>
                      {dispute.reason && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{dispute.reason}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(dispute.created_at), 'dd MMM yyyy, h:mm a')}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {dispute.order_id && (
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-xl text-xs">
                        <Link to={`/orders/${dispute.order_id}`}>Order</Link>
                      </Button>
                    )}
                    {dispute.seller_id && onSelectSeller && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-xl text-xs"
                        onClick={() => onSelectSeller(dispute.seller_id!)}
                      >
                        Store
                      </Button>
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
