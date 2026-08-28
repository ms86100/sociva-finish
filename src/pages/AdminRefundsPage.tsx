// @ts-nocheck
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Wallet, ShieldAlert } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { format } from 'date-fns';
import { paymentTypeLabel } from '@/lib/order-payment-breakdown';

const adminRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export default function AdminRefundsPage() {
  const { formatPrice } = useCurrency();

  const dashboardQuery = useQuery({
    queryKey: ['admin-sociva-balance-dashboard'],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_get_sociva_balance_refund_dashboard');
      if (error) throw error;
      return (data || {}) as Record<string, any>;
    },
  });

  const refundsQuery = useQuery({
    queryKey: ['admin-refund-console'],
    queryFn: async () => {
      const { data, error } = await adminRpc('admin_list_seller_refunds', { p_limit: 100 });
      if (error) throw error;
      return Array.isArray(data) ? data : [];
    },
  });

  const dash = dashboardQuery.data || {};
  const wallet = dash.buyer_wallet || {};
  const refunds30 = dash.refunds_last_30d || {};

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/admin" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Refund & Sociva Balance</h1>
            <p className="text-xs text-muted-foreground">
              Payment-mode-aware refunds · funding party · buyer balance reporting
            </p>
          </div>
        </div>
      </SafeHeader>

      <div className="p-4 space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              dashboardQuery.refetch();
              refundsQuery.refetch();
            }}
          >
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>

        {dashboardQuery.isError && (
          <p className="text-sm text-destructive">Dashboard could not be loaded.</p>
        )}

        {dashboardQuery.data && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={14} className="text-primary" />
                  <p className="text-sm font-semibold">Platform mode</p>
                </div>
                <p className="text-xs text-muted-foreground capitalize">
                  Gateway: {String(dash.payment_gateway_mode || 'unknown').replace(/_/g, ' ')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={dash.sociva_balance_refund_enabled ? 'default' : 'outline'}>
                    Refund credit {dash.sociva_balance_refund_enabled ? 'ON' : 'OFF'}
                  </Badge>
                  <Badge variant={dash.sociva_balance_spend_enabled ? 'default' : 'outline'}>
                    Balance spend {dash.sociva_balance_spend_enabled ? 'ON' : 'OFF'}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Open disputes: {dash.open_disputes ?? 0}
                  {dash.cod_wallet_historical_orders > 0 && (
                    <> · Historical COD+wallet orders: {dash.cod_wallet_historical_orders}</>
                  )}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Wallet size={14} className="text-emerald-700" />
                  <p className="text-sm font-semibold">Buyer Sociva Balance</p>
                </div>
                <p className="text-2xl font-bold tabular-nums">{formatPrice(Number(wallet.total_available) || 0)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {wallet.active_accounts ?? 0} active accounts
                  {wallet.frozen_accounts > 0 ? ` · ${wallet.frozen_accounts} frozen` : ''}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Cash {formatPrice(Number(wallet.total_cash_available) || 0)}
                  {' · '}Promo {formatPrice(Number(wallet.total_promo_available) || 0)}
                </p>
              </CardContent>
            </Card>

            <Card className="sm:col-span-2">
              <CardContent className="p-3 space-y-2">
                <p className="text-sm font-semibold">Refunds (last 30 days)</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-lg font-bold">{refunds30.total_requests ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Requests</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-lg font-bold">{refunds30.completed_wallet ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Wallet completed</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-lg font-bold">{refunds30.seller_resolution ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Seller resolution</p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2">
                    <p className="text-lg font-bold">{formatPrice(Number(refunds30.total_approved_amount) || 0)}</p>
                    <p className="text-[10px] text-muted-foreground">Approved total</p>
                  </div>
                </div>
                {dash.funding_party_breakdown && Object.keys(dash.funding_party_breakdown).length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Funding (90d):{' '}
                    {Object.entries(dash.funding_party_breakdown)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <h2 className="text-sm font-semibold pt-2">Recent refund requests</h2>

        {refundsQuery.isError && (
          <p className="text-sm text-destructive">Refunds could not be loaded.</p>
        )}

        {(refundsQuery.data || []).map((row: any) => {
          const approved = row.approved_amount ?? row.amount;
          const pt = paymentTypeLabel(row.payment_type);
          return (
            <Card key={row.id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{row.seller_name || 'Seller'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Order #{String(row.order_id || '').slice(0, 8)} · {row.refund_state || row.status}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {pt}
                      {Number(row.wallet_cash_amount) + Number(row.wallet_promo_amount) > 0 && (
                        <> · Wallet used {formatPrice(Number(row.wallet_cash_amount) + Number(row.wallet_promo_amount))}</>
                      )}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="font-semibold tabular-nums">{formatPrice(Number(approved) || 0)}</p>
                    <Badge variant="outline">{row.refund_destination || 'original'}</Badge>
                    {row.funding_party && (
                      <Badge variant="secondary" className="block text-[10px]">{row.funding_party}</Badge>
                    )}
                  </div>
                </div>
                {row.created_at && (
                  <p className="text-[11px] text-muted-foreground">
                    {format(new Date(row.created_at), 'MMM d, yyyy · h:mm a')}
                  </p>
                )}
                <Link to={`/admin/financial-trace?ref=${row.order_id}`} className="text-xs text-primary">
                  Open financial trace
                </Link>
              </CardContent>
            </Card>
          );
        })}

        {!refundsQuery.isLoading && (refundsQuery.data || []).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">No refund requests yet</p>
        )}
      </div>
    </AppLayout>
  );
}
