// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { PaymentRecord, Order, PaymentStatus } from '@/types/Database';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { ArrowLeft, TrendingUp, DollarSign, CreditCard, Loader2, LayoutGrid } from 'lucide-react';
import { format } from 'date-fns';
import { useCurrency } from '@/hooks/useCurrency';
import { useSellerOrderStats } from '@/hooks/queries/useSellerOrders';
import {
  emptyDashboardKpis,
  isPortfolioSellerId,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';

const PAGE_SIZE = 50;

/**
 * Earnings overview uses Settled GMV from get_seller_dashboard_kpis
 * (same source as dashboard EarningsSummary). Transaction list is recent
 * payment_records for display only — not used for all-time totals.
 */
export default function SellerEarningsPage() {
  const { user, currentSellerId, sellerProfiles } = useAuth();
  const { getPaymentStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const [payments, setPayments] = useState<(PaymentRecord & { order?: Order })[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const isPortfolio = isPortfolioSellerId(currentSellerId);
  const portfolioIds = sellerProfiles.map((s) => s.id);
  const activeSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles);
  const statsSellerKey = isPortfolio ? currentSellerId : activeSellerId;
  const { data: kpis, isLoading: kpiLoading } = useSellerOrderStats(
    statsSellerKey,
    isPortfolio ? portfolioIds : null,
  );
  const stats = kpis || emptyDashboardKpis();

  const fetchPaymentPage = useCallback(async (sellerIds: string[], before?: string) => {
    let query = supabase
      .from('payment_records')
      .select(`
        id, order_id, seller_id, amount, net_amount, payment_method, payment_status, created_at,
        order:orders(id, status, created_at, buyer:profiles!orders_buyer_id_fkey(name))
      `)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (sellerIds.length === 1) query = query.eq('seller_id', sellerIds[0]);
    else query = query.in('seller_id', sellerIds);
    if (before) query = query.lt('created_at', before);
    const { data: paymentList, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;
    return paymentList || [];
  }, []);

  const scopeIds = isPortfolio ? portfolioIds : activeSellerId ? [activeSellerId] : [];

  useEffect(() => {
    setPayments([]);
    setHasMore(false);
    setListLoading(true);
    if (user && scopeIds.length > 0) {
      fetchPaymentPage(scopeIds)
        .then((rows) => {
          setPayments(rows);
          setHasMore(rows.length >= PAGE_SIZE);
        })
        .catch((error) => {
          console.error('Error fetching payment list:', error);
        })
        .finally(() => setListLoading(false));
    } else {
      setListLoading(false);
    }
  }, [user, isPortfolio, activeSellerId, portfolioIds.join(','), fetchPaymentPage]);

  const loadMore = async () => {
    if (scopeIds.length === 0 || loadingMore || !hasMore || payments.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = payments[payments.length - 1]?.created_at;
      const rows = await fetchPaymentPage(scopeIds, cursor);
      setPayments((prev) => [...prev, ...rows]);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (error) {
      console.error('Error loading more payments:', error);
    } finally {
      setLoadingMore(false);
    }
  };

  if (kpiLoading || listLoading) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <div className="p-4">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-32 w-full rounded-xl mb-4" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/seller" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} className="text-foreground" />
          </Link>
          <h1 className="text-xl font-bold">
            {isPortfolio ? 'Completed Sales · All stores' : 'Completed Sales'}
          </h1>
        </div>
      </SafeHeader>
      <div className="p-4">
        {sellerProfiles.length > 1 && (
          <div className="mb-4 space-y-2">
            <SellerSwitcher />
            {isPortfolio && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <LayoutGrid size={12} />
                Settled GMV summed across all stores you own
              </p>
            )}
          </div>
        )}

        <Link to="/seller/payouts">
          <Card className="mb-4 border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer">
            <CardContent className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign size={18} className="text-primary" />
                <span className="text-sm font-medium">View Payout History</span>
              </div>
              <ArrowLeft size={16} className="text-muted-foreground rotate-180" />
            </CardContent>
          </Card>
        </Link>

        <div className="bg-gradient-to-r from-success/10 to-success/5 rounded-2xl p-4 mb-2">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="text-success" size={20} />
            <h3 className="font-semibold">
              {isPortfolio ? 'Settled earnings · All stores' : 'Settled earnings'}
            </h3>
          </div>
          <p className="text-[10px] text-muted-foreground mb-3">
            Completed / delivered orders · excludes refunded payments (same as dashboard)
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.todayEarnings)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">This Week</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.weekEarnings)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">This Month</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.monthEarnings)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">All Time</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.totalEarnings)}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-semibold mb-3 mt-4">Recent transactions</h3>
          <p className="text-[10px] text-muted-foreground mb-3">
            Payment records for reference — totals above use Settled GMV, not this list
          </p>
          {payments.length > 0 ? (
            <div className="space-y-3">
              {payments.map((payment) => {
                const order = payment.order as any;
                const statusInfo = getPaymentStatus(payment.payment_status as PaymentStatus);
                const amount = Number((payment as any).net_amount ?? payment.amount) || 0;

                return (
                  <Card key={payment.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                            <CreditCard size={18} className="text-muted-foreground" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">
                              Order #{payment.order_id.slice(0, 8)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {order?.buyer?.name || 'Customer'} ·{' '}
                              {format(new Date(payment.created_at), 'MMM d, yyyy')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{formatPrice(amount)}</p>
                          <p className="text-[10px] text-muted-foreground">{statusInfo.label}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {hasMore && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
                    </>
                  ) : (
                    'Load more transactions'
                  )}
                </Button>
              )}
            </div>
          ) : (
            <div className="text-center py-8 bg-muted rounded-xl">
              <p className="text-sm text-muted-foreground">No payment records yet</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
