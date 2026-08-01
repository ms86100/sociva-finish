// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { PaymentRecord, Order, PaymentStatus, SellerProfile } from '@/types/database';
import { useStatusLabels } from '@/hooks/useStatusLabels';
import { ArrowLeft, TrendingUp, DollarSign, Calendar, CreditCard } from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth, isAfter, parseISO } from 'date-fns';
import { useCurrency } from '@/hooks/useCurrency';

export default function SellerEarningsPage() {
  const { user, currentSellerId, sellerProfiles } = useAuth();
  const { getPaymentStatus } = useStatusLabels();
  const { formatPrice } = useCurrency();
  const [payments, setPayments] = useState<(PaymentRecord & { order?: Order })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    today: 0,
    thisWeek: 0,
    thisMonth: 0,
    allTime: 0,
    pendingPayout: 0,
  });

  const activeSellerId = currentSellerId || (sellerProfiles.length > 0 ? sellerProfiles[0].id : null);

  useEffect(() => {
    // Reset state immediately on store switch to prevent stale data mismatch
    setPayments([]);
    setStats({ today: 0, thisWeek: 0, thisMonth: 0, allTime: 0, pendingPayout: 0 });
    setIsLoading(true);
    if (user && activeSellerId) {
      fetchEarnings(activeSellerId);
    } else {
      setIsLoading(false);
    }
  }, [user, activeSellerId]);

  const fetchEarnings = async (sellerId: string) => {
    if (!user) return;

    try {
      // Fetch recent 50 payment records for display (not all)
      const { data: paymentList, error: fetchErr } = await supabase
        .from('payment_records')
        .select(`
          id, order_id, seller_id, amount, net_amount, payment_method, payment_status, created_at,
          order:orders(id, status, created_at, buyer:profiles!orders_buyer_id_fkey(name))
        `)
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (fetchErr) throw fetchErr;
      setPayments(paymentList);

      // Calculate stats — Bug 3: fall back to amount when net_amount is null/0
      const getAmount = (p: PaymentRecord) => Number((p as any).net_amount || p.amount) || 0;
      const today = startOfDay(new Date());
      const weekStart = startOfWeek(new Date());
      const monthStart = startOfMonth(new Date());

      const excludedOrderStatuses = ['cancelled', 'returned', 'no_show'];
      const paidPayments = paymentList.filter((p: PaymentRecord) => {
        const orderStatus = (p as any).order?.status;
        if (orderStatus && excludedOrderStatuses.includes(orderStatus)) return false;
        return p.payment_status === 'paid' || (p.payment_status === 'pending' && orderStatus === 'completed');
      });
      const todayPayments = paidPayments.filter((p: PaymentRecord) => 
        isAfter(parseISO(p.created_at), today)
      );
      const weekPayments = paidPayments.filter((p: PaymentRecord) =>
        isAfter(parseISO(p.created_at), weekStart)
      );
      const monthPayments = paidPayments.filter((p: PaymentRecord) =>
        isAfter(parseISO(p.created_at), monthStart)
      );
      const pendingPayments = paymentList.filter((p: PaymentRecord) => p.payment_status === 'pending');

      setStats({
        today: todayPayments.reduce((sum: number, p: PaymentRecord) => sum + getAmount(p), 0),
        thisWeek: weekPayments.reduce((sum: number, p: PaymentRecord) => sum + getAmount(p), 0),
        thisMonth: monthPayments.reduce((sum: number, p: PaymentRecord) => sum + getAmount(p), 0),
        allTime: paidPayments.reduce((sum: number, p: PaymentRecord) => sum + getAmount(p), 0),
        pendingPayout: pendingPayments.reduce((sum: number, p: PaymentRecord) => sum + getAmount(p), 0),
      });
    } catch (error) {
      console.error('Error fetching earnings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <AppLayout showHeader={false}>
        <div className="p-4">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-32 w-full rounded-xl mb-4" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/seller" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} className="text-foreground" />
          </Link>
          <h1 className="text-xl font-bold">Earnings & Payouts</h1>
        </div>
      </SafeHeader>
      <div className="p-4">

        {/* View Payouts Link */}
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

        {/* Earnings Overview */}
        <div className="bg-gradient-to-r from-success/10 to-success/5 rounded-2xl p-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="text-success" size={20} />
            <h3 className="font-semibold">Earnings Overview</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">Today</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.today)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">This Week</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.thisWeek)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">This Month</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.thisMonth)}</p>
            </div>
            <div className="bg-background/50 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground">All Time</p>
              <p className="text-xl font-bold text-success tabular-nums">{formatPrice(stats.allTime)}</p>
            </div>
          </div>
        </div>

        {/* Pending Payout */}
        {stats.pendingPayout > 0 && (
          <Card className="mb-6 border-warning/30 bg-warning/5">
            <CardContent className="p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                <DollarSign className="text-warning" size={24} />
              </div>
              <div className="flex-1">
                <p className="font-semibold">Pending Collection</p>
                <p className="text-sm text-muted-foreground">COD payments to collect</p>
              </div>
              <p className="text-xl font-bold text-warning tabular-nums">{formatPrice(stats.pendingPayout)}</p>
            </CardContent>
          </Card>
        )}

        {/* Transaction History */}
        <div>
          <h3 className="font-semibold mb-3">Transaction History</h3>
          
          {payments.length > 0 ? (
            <div className="space-y-3">
              {payments.map((payment) => {
                const order = payment.order as any;
                const statusInfo = getPaymentStatus(payment.payment_status as PaymentStatus);
                
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
                              {order?.buyer?.name || 'Customer'}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {format(new Date(payment.created_at), 'MMM d, h:mm a')}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{formatPrice(payment.amount)}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusInfo.color}`}>
                            {statusInfo.label}
                          </span>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {payment.payment_method.toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 bg-muted rounded-xl">
              <DollarSign className="mx-auto text-muted-foreground mb-2" size={32} />
              <p className="text-sm text-muted-foreground">No transactions yet</p>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
