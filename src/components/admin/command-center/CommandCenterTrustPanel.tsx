// @ts-nocheck
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, ShieldAlert } from 'lucide-react';
import type { CommandCenterReportRow } from '@/hooks/useCommandCenter';

const PAGE_SIZE = 50;

export function CommandCenterTrustPanel({
  rows,
  total,
  page,
  onPageChange,
  status,
  onStatusChange,
  onOpenStore360,
  isLoading,
}: {
  rows: CommandCenterReportRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  status: string;
  onStatusChange: (value: string) => void;
  onOpenStore360?: (sellerId: string) => void;
  isLoading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Trust & reports
        </p>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">open</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="reviewing">reviewing</SelectItem>
            <SelectItem value="resolved">resolved</SelectItem>
            <SelectItem value="dismissed">dismissed</SelectItem>
            <SelectItem value="closed">closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} reports</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No reports match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((report) => (
            <Card
              key={report.report_id}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
            >
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center shrink-0">
                    <ShieldAlert size={16} className="text-red-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] h-5 capitalize">
                        {report.report_type || 'report'}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px] h-5 capitalize">
                        {report.status}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold mt-1 line-clamp-2">
                      {report.description || 'No description'}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {report.reporter_name || 'Reporter'}
                      {report.reported_seller_name
                        ? ` → ${report.reported_seller_name}`
                        : report.reported_user_name
                          ? ` → ${report.reported_user_name}`
                          : ''}
                      {' · '}
                      {format(new Date(report.created_at), 'dd MMM, h:mm a')}
                    </p>
                  </div>
                </div>
                {report.reported_seller_id && onOpenStore360 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-xl text-xs shrink-0"
                    onClick={() => onOpenStore360(report.reported_seller_id!)}
                  >
                    Store 360
                  </Button>
                )}
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
