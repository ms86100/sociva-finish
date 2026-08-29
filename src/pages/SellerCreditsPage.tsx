import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';
import {
  isPortfolioSellerId,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';
import {
  buildSellerCreditUsageExplainer,
  commerceModesFromProductHints,
  creditActivityDetails,
  creditLedgerLabel,
  SELLER_CREDITS_EXHAUSTED,
} from '@/lib/sellerCredits';
import {
  resolveSellerFinancialIds,
} from '@/hooks/queries/useSellerFinancial';
import {
  useInvalidateSellerCredits,
  useSellerCreditActivity,
  useSellerCreditPackages,
  useSellerCreditRealtime,
  useSellerCreditSummary,
} from '@/hooks/queries/useSellerCredits';
import { supabase } from '@/integrations/supabase/client';
import { functionInvokeErrorMessage, parseFunctionInvokeError } from '@/lib/function-invoke-error';
import { openNativeRazorpayCheckout } from '@/lib/razorpay-native-checkout';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

const MIN_RECHARGE = 100;
const FALLBACK_PRESETS = [100, 500, 1000];
const SYNTHETIC_PHONE_EMAIL = '@phone.sociva.app';

function razorpayCheckoutPrefill(user: { email?: string | null; phone?: string | null } | null) {
  const digits = String(user?.phone || '').replace(/\D/g, '');
  const contact = digits.length >= 10 ? digits.slice(-10) : '';
  const email = user?.email && !user.email.endsWith(SYNTHETIC_PHONE_EMAIL) ? user.email : '';
  return {
    ...(contact ? { contact } : {}),
    ...(email ? { email } : {}),
  };
}

type RechargePhase = 'idle' | 'paying' | 'success' | 'failed' | 'cancelled' | 'pending';

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export default function SellerCreditsPage() {
  const { currentSellerId, sellerProfiles, user, profile } = useAuth();
  const { formatPrice } = useCurrency();
  const invalidate = useInvalidateSellerCredits();
  const isPortfolio = isPortfolioSellerId(currentSellerId);
  const portfolioIds = sellerProfiles.map((s) => s.id);
  const activeSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles);
  const currentSeller = sellerProfiles.find((s) => s.id === activeSellerId);
  const statsKey = isPortfolio ? currentSellerId : activeSellerId;
  const scopeIds = resolveSellerFinancialIds(statsKey, isPortfolio ? portfolioIds : null);
  const summaryQuery = useSellerCreditSummary(statsKey, isPortfolio ? portfolioIds : null);
  const activityQuery = useSellerCreditActivity(statsKey, isPortfolio ? portfolioIds : null);
  const packagesQuery = useSellerCreditPackages();
  useSellerCreditRealtime(scopeIds);
  const summary = summaryQuery.data;
  const exhausted = (summary?.available || 0) <= 0;
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [customError, setCustomError] = useState('');
  const [phase, setPhase] = useState<RechargePhase>('idle');
  const [creditedAmount, setCreditedAmount] = useState<number | null>(null);
  const [confirmedBalance, setConfirmedBalance] = useState<number | null>(null);
  const [statusMessage, setStatusMessage] = useState('');

  const commerceModesQuery = useQuery({
    queryKey: ['seller-commerce-modes', activeSellerId],
    queryFn: async () => {
      if (!activeSellerId || isPortfolio) return [];
      const { data, error } = await supabase
        .from('products')
        .select('action_type, listing_type')
        .eq('seller_id', activeSellerId)
        .limit(200);
      if (error) throw error;
      return commerceModesFromProductHints(data || []);
    },
    enabled: Boolean(activeSellerId) && !isPortfolio,
    staleTime: 60_000,
  });

  const usageExplainer = useMemo(
    () => buildSellerCreditUsageExplainer({
      formatPrice,
      rates: summary?.billingRates || [],
      modes: commerceModesQuery.data || [],
    }),
    [formatPrice, summary?.billingRates, commerceModesQuery.data],
  );

  const presets = useMemo(() => {
    const packs = (packagesQuery.data || []).map((pack: { amount?: number; credits_amount?: number }) =>
      Number(pack.amount ?? pack.credits_amount),
    ).filter((amount) => Number.isFinite(amount) && amount >= MIN_RECHARGE);
    const unique = Array.from(new Set(packs.length ? packs : FALLBACK_PRESETS));
    return unique.sort((a, b) => a - b);
  }, [packagesQuery.data]);

  const resolvedAmount = useMemo(() => {
    const custom = parseAmount(customAmount);
    if (custom != null) return custom;
    return selectedAmount;
  }, [customAmount, selectedAmount]);

  const selectPreset = (amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
    setCustomError('');
    if (phase === 'failed' || phase === 'cancelled') setPhase('idle');
  };

  const onCustomChange = (value: string) => {
    setCustomAmount(value);
    setSelectedAmount(null);
    setCustomError('');
    if (phase === 'failed' || phase === 'cancelled') setPhase('idle');
  };

  const recharge = async () => {
    if (isPortfolio || !activeSellerId) {
      toast.error('Select one store before recharging credits.');
      return;
    }
    const amount = resolvedAmount;
    if (amount == null) {
      setCustomError('Enter a recharge amount.');
      return;
    }
    if (amount < MIN_RECHARGE) {
      setCustomError(`Minimum recharge amount is ₹${MIN_RECHARGE}.`);
      return;
    }
    setPhase('paying');
    setStatusMessage('');
    try {
      const matchingPack = (packagesQuery.data || []).find((pack: { amount?: number; credits_amount?: number; id: string }) =>
        Number(pack.amount ?? pack.credits_amount) === amount,
      );
      const { data, error } = await supabase.functions.invoke('create-seller-credit-order', {
        body: matchingPack?.id
          ? { seller_id: activeSellerId, package_id: matchingPack.id }
          : { seller_id: activeSellerId, amount },
      });
      if (error || data?.error) {
        throw new Error(await functionInvokeErrorMessage({ error, data }));
      }
      const keyId = data?.key_id;
      const orderId = data?.razorpay_order_id;
      const amountPaise = data?.amount_paise;
      const purchaseId = data?.purchase_id;
      if (!keyId || !orderId) throw new Error('Payment could not start.');

      const outcome = await new Promise<{
        status: 'verified' | 'failed' | 'cancelled' | 'pending';
        available?: number;
        message?: string;
      }>((resolve) => {
        void openNativeRazorpayCheckout({
          key: keyId,
          amount: amountPaise,
          currency: 'INR',
          name: 'Sociva Credits',
          description: 'Prepaid platform usage',
          order_id: orderId,
          prefill: razorpayCheckoutPrefill({
            email: user?.email,
            phone: user?.phone || profile?.phone,
          }),
          handler: async (response) => {
            const confirm = await supabase.functions.invoke('confirm-seller-credit-payment', {
              body: {
                purchase_id: purchaseId,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_order_id: response.razorpay_order_id,
                razorpay_signature: response.razorpay_signature,
              },
            });
            if (confirm.error || confirm.data?.error) {
              const parsed = await parseFunctionInvokeError(confirm);
              if (parsed.pending && !/mismatch/i.test(parsed.message)) {
                resolve({
                  status: 'pending',
                  message: "We're confirming this payment. Your Sociva Credits will appear after verification.",
                });
                return;
              }
              resolve({
                status: 'failed',
                message: parsed.message || 'Payment could not be verified. Your account has not been credited unless verification succeeds.',
              });
              return;
            }
            resolve({
              status: 'verified',
              available: Number(confirm.data?.available),
            });
          },
          onDismiss: () => resolve({ status: 'cancelled' }),
          onFailure: () => {
            resolve({
              status: 'failed',
              message: 'We couldn\'t complete your Sociva Credit recharge. Your account has not been charged/credited unless the payment was successfully verified.',
            });
          },
        }).catch((error) => {
          resolve({
            status: 'failed',
            message: error instanceof Error ? error.message : 'Could not load payment checkout.',
          });
        });
      });

      if (outcome.status === 'verified') {
        setCreditedAmount(amount);
        setConfirmedBalance(Number.isFinite(outcome.available) ? outcome.available : null);
        setPhase('success');
        invalidate();
        return;
      }
      if (outcome.status === 'pending') {
        setPhase('pending');
        setStatusMessage(outcome.message || "We're confirming this payment.");
        invalidate();
        return;
      }
      if (outcome.status === 'cancelled') {
        setPhase('cancelled');
        return;
      }
      setPhase('failed');
      setStatusMessage(outcome.message || 'Recharge could not be completed.');
    } catch (err) {
      setPhase('failed');
      setStatusMessage(err instanceof Error ? err.message : 'Recharge could not be completed.');
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

  if (phase === 'success') {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <SafeHeader>
          <div className="px-4 pb-3 flex items-center gap-3">
            <Link to="/seller" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
              <ArrowLeft size={18} />
            </Link>
            <h1 className="text-xl font-bold">Sociva Credits</h1>
          </div>
        </SafeHeader>
        <div className="p-4">
          <Card>
            <CardContent className="p-6 space-y-4 text-center">
              <CheckCircle2 className="mx-auto text-success" size={36} />
              <div>
                <p className="text-lg font-bold">Recharge Successful</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {formatPrice(creditedAmount || 0)} has been added to your Sociva Credits.
                </p>
              </div>
              <div className="rounded-xl bg-muted/60 px-4 py-3">
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="text-2xl font-bold tabular-nums">{formatPrice(confirmedBalance ?? summaryQuery.data?.available ?? 0)}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatPrice(creditedAmount || 0)} was added. Your products can appear to nearby buyers.
                {usageExplainer.lines[0] ? ` ${usageExplainer.lines[0]}` : ''}
              </p>
              {usageExplainer.lines.length > 1 && (
                <ul className="text-left text-xs text-muted-foreground space-y-1.5 px-1">
                  {usageExplainer.lines.slice(1).map((line) => (
                    <li key={line}>• {line}</li>
                  ))}
                </ul>
              )}
              <Link to="/seller">
                <Button className="w-full">Continue to Seller Dashboard</Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 space-y-2">
          <div className="flex items-center gap-3">
            <Link to="/seller" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0">
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold leading-tight">Sociva Credits</h1>
              {!isPortfolio && currentSeller?.business_name && (
                <p className="text-[11px] text-muted-foreground truncate">{currentSeller.business_name}</p>
              )}
            </div>
          </div>
          {sellerProfiles.length > 1 && <SellerSwitcher variant="header" />}
        </div>
      </SafeHeader>
      <div className="p-4 space-y-4">
        {(summary?.available || 0) <= 0 && (
          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="p-4 space-y-1">
              <p className="font-semibold">Your store is approved!</p>
              <p className="text-sm text-muted-foreground">
                Recharge Sociva Credits to make your products visible to buyers nearby and to keep accepting new activity for your store.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-[11px] text-muted-foreground">Platform credits for listings and activity — not customer earnings.</p>
            <p className="font-semibold text-sm">{usageExplainer.headline}</p>
            <ul className="space-y-1.5">
              {usageExplainer.lines.map((line) => (
                <li key={line} className="text-xs text-muted-foreground leading-relaxed">
                  {line}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Coins className="text-primary" size={20} />
                <p className="font-semibold">Listing credits ready</p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{formatPrice(summary?.available || 0)}</p>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Held on open orders</span>
              <span className="font-semibold tabular-nums">{formatPrice(summary?.reserved || 0)}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Ready credits can list or accept new activity. Held credits return after those orders finish.</p>
            {exhausted && summary?.spendEnabled && (
              <p className="text-sm text-destructive">{SELLER_CREDITS_EXHAUSTED}</p>
            )}
            <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div>Purchased<br /><strong className="text-foreground">{formatPrice(summary?.lifetimePurchased || 0)}</strong></div>
              <div>Used<br /><strong className="text-foreground">{formatPrice(summary?.lifetimeConsumed || 0)}</strong></div>
              <div>Held<br /><strong className="text-foreground">{formatPrice(summary?.reserved || 0)}</strong></div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Used this month {formatPrice(summary?.usedThisMonth || 0)} · Orders {summary?.ordersThisMonth || 0} · Enquiries {summary?.enquiriesThisMonth || 0} · Bookings {summary?.bookingsThisMonth || 0} · Contacts {summary?.contactsThisMonth || 0}
            </p>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Recharge Sociva Credits</h2>
          {isPortfolio && (
            <p className="text-xs text-muted-foreground">Select one store before recharging credits.</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            {presets.map((amount) => (
              <Button
                key={amount}
                type="button"
                variant={selectedAmount === amount && !customAmount ? 'default' : 'outline'}
                className={cn('h-11', selectedAmount === amount && !customAmount && 'ring-2 ring-primary/40')}
                disabled={isPortfolio || phase === 'paying'}
                onClick={() => selectPreset(amount)}
              >
                {formatPrice(amount)}
              </Button>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Or enter custom amount</p>
            <Input
              inputMode="decimal"
              placeholder="₹________"
              value={customAmount}
              disabled={isPortfolio || phase === 'paying'}
              onChange={(event) => onCustomChange(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Minimum recharge: {formatPrice(MIN_RECHARGE)}</p>
            {customError && <p className="text-xs text-destructive">{customError}</p>}
          </div>
          {(phase === 'failed' || phase === 'cancelled' || phase === 'pending') && (
            <div className={cn('rounded-xl border p-3', phase === 'pending' ? 'border-warning/30 bg-warning/10' : 'border-destructive/20 bg-destructive/10')}>
              <p className="text-sm font-semibold">
                {phase === 'pending' ? 'Payment verification pending' : phase === 'cancelled' ? 'Payment cancelled' : 'Recharge could not be completed'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {phase === 'pending'
                  ? statusMessage
                  : phase === 'cancelled'
                    ? 'No Sociva Credits were added. You can select an amount and try again.'
                    : statusMessage || "We couldn't complete your Sociva Credit recharge. Your account has not been charged/credited unless the payment was successfully verified."}
              </p>
            </div>
          )}
          <Button
            className="w-full h-11"
            disabled={isPortfolio || phase === 'paying'}
            onClick={() => {
              if (phase === 'failed' || phase === 'cancelled') setPhase('idle');
              recharge();
            }}
          >
            {phase === 'paying' ? 'Opening payment…' : phase === 'failed' || phase === 'cancelled' ? 'Try Again' : 'Recharge Now'}
          </Button>
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
