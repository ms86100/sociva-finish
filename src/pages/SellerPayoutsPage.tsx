// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import {
  ArrowLeft,
  Banknote,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  LayoutGrid,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  isPortfolioSellerId,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';

const PAGE_SIZE = 50;

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  eligible: { label: 'Eligible — payout pending Route setup', color: 'bg-primary/10 text-primary border-primary/20', icon: Clock },
  settled: { label: 'Paid out', color: 'bg-success/10 text-success border-success/20', icon: CheckCircle2 },
  processing: { label: 'Transfer in progress', color: 'bg-primary/10 text-primary border-primary/20', icon: Clock },
  pending: { label: 'Pending eligibility', color: 'bg-warning/10 text-warning border-warning/20', icon: Clock },
  on_hold: { label: 'On Hold', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: AlertCircle },
};

async function fetchSettlementTotals(sellerIds: string[]) {
  if (sellerIds.length === 0) return { totalSettled: 0, totalPending: 0 };

  const { data, error } = await supabase.rpc('get_seller_settlement_totals', {
    p_seller_ids: sellerIds,
  });
  if (!error && data) {
    const raw = data as Record<string, unknown>;
    return {
      totalSettled: Number(raw.total_settled) || 0,
      totalPending: Number(raw.total_pending) || 0,
    };
  }

  // Fallback if RPC not yet available locally
  console.warn('[SellerPayouts] settlement totals RPC fallback:', error?.message);
  let query = supabase.from('seller_settlements').select('net_amount, settlement_status');
  if (sellerIds.length === 1) query = query.eq('seller_id', sellerIds[0]);
  else query = query.in('seller_id', sellerIds);

  const { data: rows, error: qErr } = await query;
  if (qErr) throw qErr;

  let totalSettled = 0;
  let totalPending = 0;
  for (const row of rows || []) {
    const amt = Number(row.net_amount) || 0;
    if (row.settlement_status === 'settled') totalSettled += amt;
    else totalPending += amt;
  }
  return { totalSettled, totalPending };
}

export default function SellerPayoutsPage() {
  const { user, currentSellerId, sellerProfiles } = useAuth();
  const { formatPrice } = useCurrency();
  const [settlements, setSettlements] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalSettled, setTotalSettled] = useState(0);
  const [totalPending, setTotalPending] = useState(0);

  const isPortfolio = isPortfolioSellerId(currentSellerId);
  const portfolioIds = sellerProfiles.map((s) => s.id);
  const activeSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles);
  const scopeIds = isPortfolio ? portfolioIds : activeSellerId ? [activeSellerId] : [];

  const fetchSettlementPage = useCallback(async (sellerIds: string[], before?: string) => {
    let query = supabase
      .from('seller_settlements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    if (sellerIds.length === 1) query = query.eq('seller_id', sellerIds[0]);
    else query = query.in('seller_id', sellerIds);
    if (before) query = query.lt('created_at', before);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, []);

  useEffect(() => {
    setSettlements([]);
    setHasMore(false);
    setTotalSettled(0);
    setTotalPending(0);
    setIsLoading(true);
    if (!user || scopeIds.length === 0) {
      setIsLoading(false);
      return;
    }
    Promise.all([fetchSettlementTotals(scopeIds), fetchSettlementPage(scopeIds)])
      .then(([totals, rows]) => {
        setTotalSettled(totals.totalSettled);
        setTotalPending(totals.totalPending);
        setSettlements(rows);
        setHasMore(rows.length >= PAGE_SIZE);
      })
      .catch((err) => {
        console.error('Error fetching settlements:', err);
      })
      .finally(() => setIsLoading(false));
  }, [user, isPortfolio, activeSellerId, portfolioIds.join(','), fetchSettlementPage]);

  const loadMore = async () => {
    if (scopeIds.length === 0 || loadingMore || !hasMore || settlements.length === 0) return;
    setLoadingMore(true);
    try {
      const cursor = settlements[settlements.length - 1]?.created_at;
      const rows = await fetchSettlementPage(scopeIds, cursor);
      setSettlements((prev) => [...prev, ...rows]);
      setHasMore(rows.length >= PAGE_SIZE);
    } catch (err) {
      console.error('Error loading more settlements:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <div className="p-4 safe-top">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-32 w-full rounded-xl mb-4" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (sellerProfiles.length > 1 && !isPortfolio && !activeSellerId) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <SafeHeader>
          <div className="px-4 pb-3 flex items-center gap-3">
            <Link to="/seller/earnings" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
              <ArrowLeft size={18} className="text-foreground" />
            </Link>
            <h1 className="text-xl font-bold">Payouts</h1>
          </div>
        </SafeHeader>
        <div className="p-4">
          <div className="rounded-xl border border-border bg-muted/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <LayoutGrid size={16} className="text-muted-foreground" />
              <p className="text-sm font-medium">Select a store or All stores</p>
            </div>
            <SellerSwitcher />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/seller/earnings" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} className="text-foreground" />
          </Link>
          <h1 className="text-xl font-bold">
            {isPortfolio ? 'Payouts · All stores' : 'Payouts'}
          </h1>
        </div>
      </SafeHeader>

      <div className="p-4 space-y-4">
        {sellerProfiles.length > 1 && (
          <div className="space-y-2">
            <SellerSwitcher />
            {isPortfolio && (
              <p className="text-[11px] text-muted-foreground">
                Totals below are summed across all stores you own (not a single-store blend).
              </p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-3 text-sm">
          <p className="font-medium text-foreground">Ledger only — not a bank payout</p>
          <p className="text-xs text-muted-foreground mt-1">
            These rows track amounts owed after delivery. Razorpay Route automatic transfers are not enabled, so “Eligible” means payout is pending platform Route setup — money has not been transferred.
          </p>
        </div>

        {/* Summary Cards — from full aggregate, not the page list */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="p-4 text-center">
              <TrendingUp size={20} className="mx-auto text-success mb-1" />
              <p className="text-xs text-muted-foreground">
                Actually paid out{isPortfolio ? ' · All stores' : ''}
              </p>
              <p className="text-lg font-bold text-success tabular-nums">{formatPrice(totalSettled)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <Clock size={20} className="mx-auto text-warning mb-1" />
              <p className="text-xs text-muted-foreground">
                Owed (pending / eligible){isPortfolio ? ' · All stores' : ''}
              </p>
              <p className="text-lg font-bold text-warning tabular-nums">{formatPrice(totalPending)}</p>
            </CardContent>
          </Card>
        </div>

        <h3 className="font-semibold">Settlement History</h3>
        {settlements.length > 0 ? (
          <div className="space-y-3">
            {settlements.map((s) => {
              const config = STATUS_CONFIG[s.settlement_status] || STATUS_CONFIG.pending;
              const Icon = config.icon;
              const storeName =
                isPortfolio && s.seller_id
                  ? sellerProfiles.find((p) => p.id === s.seller_id)?.business_name
                  : null;
              return (
                <Card key={s.id}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <Banknote size={18} className="text-muted-foreground" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">
                            {s.period_start && s.period_end
                              ? `${format(new Date(s.period_start), 'MMM d')} – ${format(new Date(s.period_end), 'MMM d')}`
                              : `Settlement #${s.id.slice(0, 8)}`}
                          </p>
                          {storeName && (
                            <p className="text-[10px] text-primary font-medium">{storeName}</p>
                          )}
                          {s.total_orders && (
                            <p className="text-xs text-muted-foreground">
                              {s.total_orders} order{s.total_orders > 1 ? 's' : ''}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground">
                            {format(new Date(s.created_at), 'MMM d, yyyy')}
                          </p>
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <p className="font-semibold tabular-nums">{formatPrice(s.net_amount || 0)}</p>
                        <Badge variant="outline" className={`text-[10px] ${config.color}`}>
                          <Icon size={10} className="mr-0.5" />
                          {config.label}
                        </Badge>
                        {s.platform_fee > 0 && (
                          <p className="text-[10px] text-muted-foreground">Fee: {formatPrice(s.platform_fee)}</p>
                        )}
                      </div>
                    </div>
                    {s.hold_reason && (
                      <p className="text-xs text-destructive mt-2 bg-destructive/5 rounded px-2 py-1">{s.hold_reason}</p>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {hasMore && (
              <Button variant="secondary" className="w-full" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...
                  </>
                ) : (
                  'Load more'
                )}
              </Button>
            )}
          </div>
        ) : (
          <div className="text-center py-12 bg-muted rounded-xl">
            <Banknote className="mx-auto text-muted-foreground mb-2" size={32} />
            <p className="text-sm text-muted-foreground">No settlements yet</p>
            <p className="text-xs text-muted-foreground mt-1">Settlements will appear here once orders are processed</p>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
