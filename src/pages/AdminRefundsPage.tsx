// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { format } from 'date-fns';

const adminRpc = supabase.rpc as unknown as (
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export default function AdminRefundsPage() {
  const { formatPrice } = useCurrency();
  const query = useQuery({
    queryKey: ['admin-refund-console'],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_refunds', { p_limit: 100 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  });

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/admin" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Refund console</h1>
            <p className="text-xs text-muted-foreground">Partial refunds reduce earnings by the refunded amount only</p>
          </div>
        </div>
      </SafeHeader>
      <div className="p-4 space-y-3">
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => query.refetch()}>
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>
        {query.isError && (
          <p className="text-sm text-destructive">Refunds could not be loaded.</p>
        )}
        {(query.data || []).map((row: any) => (
          <Card key={row.id}>
            <CardContent className="p-3 space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{row.seller_name || 'Seller'}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Order #{String(row.order_id || '').slice(0, 8)} · {row.refund_state || row.status}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Order total {formatPrice(Number(row.order_total) || 0)} · Refunded so far {formatPrice(Number(row.order_amount_refunded) || 0)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatPrice(Number(row.amount) || 0)}</p>
                  <Badge variant="outline">{row.refund_destination || 'original'}</Badge>
                </div>
              </div>
              {row.created_at && (
                <p className="text-[11px] text-muted-foreground">{format(new Date(row.created_at), 'MMM d, yyyy · h:mm a')}</p>
              )}
              <Link to={`/admin/financial-trace?ref=${row.order_id}`} className="text-xs text-primary">
                Open financial trace
              </Link>
            </CardContent>
          </Card>
        ))}
        {!query.isLoading && (query.data || []).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">No refund requests yet</p>
        )}
      </div>
    </AppLayout>
  );
}
