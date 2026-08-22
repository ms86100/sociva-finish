import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';
import {
  isPortfolioSellerId,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';
import {
  creditActivityDetails,
  creditLedgerLabel,
  SELLER_CREDITS_EXHAUSTED,
} from '@/lib/sellerCredits';
import {
  resolveSellerFinancialIds,
  sellerFinancialScopeKey,
} from '@/hooks/queries/useSellerFinancial';
import {
  useInvalidateSellerCredits,
  useSellerCreditActivity,
  useSellerCreditPackages,
  useSellerCreditRealtime,
  useSellerCreditSummary,
} from '@/hooks/queries/useSellerCredits';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ArrowLeft, Coins } from 'lucide-react';

export default function SellerCreditsPage() {
  const { currentSellerId, sellerProfiles, user } = useAuth();
  const { formatPrice } = useCurrency();
  const invalidate = useInvalidateSellerCredits();
  const isPortfolio = isPortfolioSellerId(currentSellerId);
  const portfolioIds = sellerProfiles.map((s) => s.id);
  const activeSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles);
  const statsKey = isPortfolio ? currentSellerId : activeSellerId;
  const scopeIds = resolveSellerFinancialIds(statsKey, isPortfolio ? portfolioIds : null);
  const summaryQuery = useSellerCreditSummary(statsKey, isPortfolio ? portfolioIds : null);
  const activityQuery = useSellerCreditActivity(statsKey, isPortfolio ? portfolioIds : null);
  const packagesQuery = useSellerCreditPackages();
  useSellerCreditRealtime(scopeIds);
  const [buying, setBuying] = useState<string | null>(null);
  const summary = summaryQuery.data;
  const exhausted = (summary?.available || 0) <= 0;

  const buy = async (packageId: string) => {
    if (isPortfolio || !activeSellerId) {
      toast.error('Select one store before recharging credits.');
      return;
    }
    setBuying(packageId);
    try {
      const { data, error } = await supabase.functions.invoke('create-seller-credit-order', {
        body: { seller_id: activeSellerId, package_id: packageId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const keyId = data?.key_id;
      const orderId = data?.razorpay_order_id;
      const amountPaise = data?.amount_paise;
      const purchaseId = data?.purchase_id;
      if (!keyId || !orderId) throw new Error('Payment could not start.');

      await new Promise<void>((resolve, reject) => {
        const start = () => {
          const rzp = new window.Razorpay({
            key: keyId,
            amount: amountPaise,
            currency: 'INR',
            name: 'Sociva Credits',
            description: 'Prepaid platform usage',
            order_id: orderId,
            prefill: { email: user?.email || '' },
            handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string }) => {
              const confirm = await supabase.functions.invoke('confirm-seller-credit-payment', {
                body: {
                  purchase_id: purchaseId,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                },
              });
              if (confirm.error || confirm.data?.error) {
                reject(new Error(confirm.error?.message || confirm.data?.error || 'Payment failed. Your Sociva Credits were not added.'));
                return;
              }
              resolve();
            },
            modal: {
              ondismiss: () => reject(new Error('Payment cancelled. Your Sociva Credits were not added.')),
            },
          });
          rzp.on('payment.failed', () => {
            reject(new Error('Payment failed. Your Sociva Credits were not added.'));
          });
          rzp.open();
        };
        if (window.Razorpay) start();
        else {
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = start;
          script.onerror = () => reject(new Error('Could not load payment checkout.'));
          document.body.appendChild(script);
        }
      });
      toast.success('Sociva Credits added successfully.');
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed. Your Sociva Credits were not added.');
    } finally {
      setBuying(null);
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <div className="p-4 space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-36 w-full" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link to="/seller" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">Sociva Credits</h1>
            <p className="text-xs text-muted-foreground">Prepaid platform usage — not customer earnings</p>
          </div>
          <SellerSwitcher />
        </div>
      </SafeHeader>
      <div className="p-4 space-y-4">
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins className="text-primary" size={20} />
                <p className="font-semibold">Available</p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{formatPrice(summary?.available || 0)}</p>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Reserved</span>
              <span className="font-semibold tabular-nums">{formatPrice(summary?.reserved || 0)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Total available for new activity {formatPrice(summary?.available || 0)}</p>
            {exhausted && <p className="text-sm text-destructive">{SELLER_CREDITS_EXHAUSTED}</p>}
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div>Purchased<br /><strong className="text-foreground">{formatPrice(summary?.lifetimePurchased || 0)}</strong></div>
              <div>Used<br /><strong className="text-foreground">{formatPrice(summary?.lifetimeConsumed || 0)}</strong></div>
              <div>Reserved<br /><strong className="text-foreground">{formatPrice(summary?.reserved || 0)}</strong></div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Used this month {formatPrice(summary?.usedThisMonth || 0)} · Orders {summary?.ordersThisMonth || 0} · Enquiries {summary?.enquiriesThisMonth || 0} · Bookings {summary?.bookingsThisMonth || 0} · Contacts {summary?.contactsThisMonth || 0}
            </p>
          </CardContent>
        </Card>

        <div>
          <h2 className="text-sm font-semibold mb-2">Recharge</h2>
          {!summary?.purchaseEnabled && (
            <p className="text-xs text-muted-foreground mb-2">Credit purchases will be available when admin enables recharge.</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(packagesQuery.data || []).map((pack: any) => (
              <Button
                key={pack.id}
                variant="outline"
                disabled={!summary?.purchaseEnabled || isPortfolio || buying === pack.id}
                onClick={() => buy(pack.id)}
              >
                {pack.label || formatPrice(Number(pack.credits_amount ?? pack.amount))}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-2">Credit Activity</h2>
          {(activityQuery.data || []).map((row: any) => (
            <Card key={row.id} className="mb-2">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{creditLedgerLabel(row.type, row.event_type)}</p>
                    {creditActivityDetails(row).map((line) => (
                      <p key={line} className="text-[11px] text-muted-foreground">{line}</p>
                    ))}
                    {row.created_at && (
                      <p className="text-[11px] text-muted-foreground">{format(new Date(row.created_at), 'MMM d, yyyy · h:mm a')}</p>
                    )}
                  </div>
                  <p className={`font-semibold tabular-nums ${Number(row.amount) < 0 ? 'text-destructive' : 'text-success'}`}>
                    {Number(row.amount) > 0 ? '+' : ''}{formatPrice(Number(row.amount) || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
          {!activityQuery.isLoading && (activityQuery.data || []).length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No credit activity yet</p>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
