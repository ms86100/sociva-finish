// @ts-nocheck
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { CommandCenterAttentionRow } from '@/hooks/useCommandCenter';

const PAGE_SIZE = 50;

const KIND_LABELS: Record<string, string> = {
  pending_store_verifications: 'Pending store',
  pending_product_approvals: 'Pending product',
  open_disputes: 'Open dispute',
  unanswered_enquiries: 'Unanswered',
  open_refunds: 'Open refund',
  payment_pending_orders: 'Payment pending',
};

const KIND_COLORS: Record<string, string> = {
  pending_store_verifications: 'bg-amber-100 text-amber-800',
  pending_product_approvals: 'bg-amber-100 text-amber-800',
  open_disputes: 'bg-red-100 text-red-800',
  unanswered_enquiries: 'bg-orange-100 text-orange-800',
  open_refunds: 'bg-violet-100 text-violet-800',
  payment_pending_orders: 'bg-blue-100 text-blue-800',
};

export function CommandCenterAttentionInbox({
  rows,
  total,
  page,
  onPageChange,
  onDrillKind,
  isLoading,
}: {
  rows: CommandCenterAttentionRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  onDrillKind: (kind: string, row: CommandCenterAttentionRow) => void;
  isLoading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Attention queue
        </p>
        <p className="text-xs text-muted-foreground font-medium">{total} items</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No attention items right now.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <Card
              key={`${row.kind}-${row.entity_id}`}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
            >
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        KIND_COLORS[row.kind] || 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {KIND_LABELS[row.kind] || row.kind}
                    </span>
                    {row.status && (
                      <Badge variant="outline" className="text-[10px] h-5 capitalize">
                        {row.status}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-semibold mt-1 truncate">{row.title}</p>
                  {row.subtitle && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{row.subtitle}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {row.seller_name || '—'}
                    {row.created_at
                      ? ` · ${format(new Date(row.created_at), 'dd MMM, h:mm a')}`
                      : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-xl text-xs shrink-0"
                  onClick={() => onDrillKind(row.kind, row)}
                >
                  Open
                </Button>
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
