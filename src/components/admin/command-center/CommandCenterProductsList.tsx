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
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import type { CommandCenterProductRow } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';

const PAGE_SIZE = 25;

const APPROVAL_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export function CommandCenterProductsList({
  rows,
  total,
  page,
  onPageChange,
  approvalStatus,
  availableOnly,
  search,
  onApprovalStatusChange,
  onAvailableOnlyChange,
  onSearchChange,
  isLoading,
}: {
  rows: CommandCenterProductRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  approvalStatus: string;
  availableOnly: string;
  search: string;
  onApprovalStatusChange: (value: string) => void;
  onAvailableOnlyChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  isLoading?: boolean;
}) {
  const { formatPrice } = useCurrency();
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search product, store…"
          className="h-9 max-w-xs rounded-xl text-sm"
        />
        <Select value={approvalStatus} onValueChange={onApprovalStatusChange}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs">
            <SelectValue placeholder="Approval" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All approval</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="approved">approved</SelectItem>
            <SelectItem value="rejected">rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={availableOnly} onValueChange={onAvailableOnlyChange}>
          <SelectTrigger className="h-9 w-36 rounded-xl text-xs">
            <SelectValue placeholder="Availability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any availability</SelectItem>
            <SelectItem value="live">Live only</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} products</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No products match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((product) => (
            <Card
              key={product.product_id}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Package size={16} className="text-emerald-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold truncate">{product.name}</p>
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize',
                            APPROVAL_COLORS[product.approval_status] || 'bg-muted text-muted-foreground',
                          )}
                        >
                          {product.approval_status}
                        </span>
                        {product.is_service && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            Service
                          </Badge>
                        )}
                        {!product.is_available && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {product.seller_name || 'Store'} · {product.category || 'Uncategorized'}
                        {product.subcategory_name ? ` · ${product.subcategory_name}` : ''}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {product.society_name || 'Society'} · updated{' '}
                        {format(new Date(product.updated_at || product.created_at), 'dd MMM yyyy')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums">{formatPrice(product.price)}</p>
                    <Button asChild size="sm" variant="outline" className="h-8 mt-2 rounded-xl text-xs">
                      <Link to={`/products/${product.product_id}`}>Open</Link>
                    </Button>
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
