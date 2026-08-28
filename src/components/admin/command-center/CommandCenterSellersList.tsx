// @ts-nocheck
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Store } from 'lucide-react';
import type { CommandCenterSellerRow } from '@/hooks/useCommandCenter';

const PAGE_SIZE = 25;

const VERIFICATION_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export function CommandCenterSellersList({
  rows,
  total,
  page,
  onPageChange,
  verificationStatus,
  activeOnly,
  search,
  onVerificationStatusChange,
  onActiveOnlyChange,
  onSearchChange,
  onSelectSeller,
  isLoading,
}: {
  rows: CommandCenterSellerRow[];
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  verificationStatus: string;
  activeOnly: string;
  search: string;
  onVerificationStatusChange: (value: string) => void;
  onActiveOnlyChange: (value: string) => void;
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
          placeholder="Search store, owner, phone…"
          className="h-9 max-w-xs rounded-xl text-sm"
        />
        <Select value={verificationStatus} onValueChange={onVerificationStatusChange}>
          <SelectTrigger className="h-9 w-40 rounded-xl text-xs">
            <SelectValue placeholder="Verification" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verification</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="approved">approved</SelectItem>
            <SelectItem value="rejected">rejected</SelectItem>
          </SelectContent>
        </Select>
        <Select value={activeOnly} onValueChange={onActiveOnlyChange}>
          <SelectTrigger className="h-9 w-36 rounded-xl text-xs">
            <SelectValue placeholder="Availability" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any availability</SelectItem>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive / vacation</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground font-medium">{total} stores</p>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No stores match these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((seller) => (
            <Card
              key={seller.seller_id}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden"
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                      <Store size={16} className="text-violet-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold truncate">{seller.business_name}</p>
                        <span
                          className={cn(
                            'text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize',
                            VERIFICATION_COLORS[seller.verification_status] || 'bg-muted text-muted-foreground',
                          )}
                        >
                          {seller.verification_status}
                        </span>
                        {seller.vacation_mode && (
                          <Badge variant="outline" className="text-[10px] h-5">
                            Vacation
                          </Badge>
                        )}
                        {!seller.is_available && (
                          <Badge variant="secondary" className="text-[10px] h-5">
                            Unavailable
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {seller.owner_name || 'Owner'} · {seller.owner_phone || '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {seller.society_name || 'Society'} · joined {format(new Date(seller.created_at), 'dd MMM yyyy')}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {seller.live_product_count}/{seller.product_count} live listings · {seller.orders_30d} orders (30d)
                      </p>
                    </div>
                  </div>
                  {onSelectSeller && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-xl text-xs shrink-0"
                      onClick={() => onSelectSeller(seller.seller_id)}
                    >
                      Orders
                    </Button>
                  )}
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
