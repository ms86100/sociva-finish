// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/useCurrency';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';
import { SellerTransferBanner } from '@/components/seller/SellerTransferBanner';
import {
  isPortfolioSellerId,
  resolveOperationalSellerId,
} from '@/lib/seller-order-board';
import {
  activityLabel,
  isWithdrawableSource,
} from '@/lib/sellerFinancialTruth';
import {
  resolveSellerFinancialIds,
  useInvalidateSellerFinancial,
  useSellerFinancialActivity,
  useSellerFinancialRealtime,
  useSellerFinancialSummary,
  useSellerPayoutReadiness,
  useSellerWithdrawalRequests,
} from '@/hooks/queries/useSellerFinancial';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Banknote,
  Clock,
  LayoutGrid,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

const financialRpc = (name: string, args?: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;

export default function SellerWalletPage() {
  const { currentSellerId, sellerProfiles } = useAuth();
  const { formatPrice } = useCurrency();
  const invalidate = useInvalidateSellerFinancial();
  const isPortfolio = isPortfolioSellerId(currentSellerId);
  const portfolioIds = sellerProfiles.map((s) => s.id);
  const activeSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles);
  const statsKey = isPortfolio ? currentSellerId : activeSellerId;
  const scopeIds = resolveSellerFinancialIds(statsKey, isPortfolio ? portfolioIds : null);

  const summaryQuery = useSellerFinancialSummary(statsKey, isPortfolio ? portfolioIds : null);
  const activityQuery = useSellerFinancialActivity(statsKey, isPortfolio ? portfolioIds : null);
  const withdrawalsQuery = useSellerWithdrawalRequests(statsKey, isPortfolio ? portfolioIds : null);
  const readinessQuery = useSellerPayoutReadiness();
  useSellerFinancialRealtime(scopeIds);

  const finance = summaryQuery.data;
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const requestWithdrawal = async () => {
    if (isPortfolio || !activeSellerId) {
      toast.error('Select one store before requesting a withdrawal.');
      return;
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Enter a withdrawal amount greater than zero.');
      return;
    }
    if (value > (finance?.available || 0)) {
      toast.error('Amount cannot exceed available online earnings.');
      return;
    }
    if (!readinessQuery.data?.canRequestWithdrawal) {
      toast.error(readinessQuery.data?.reason || 'Withdrawals are not enabled yet.');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await financialRpc('request_seller_withdrawal', {
        p_seller_id: activeSellerId,
        p_amount: value,
      });
      if (error) throw error;
      toast.success('Withdrawal requested. We will notify you after the transfer is confirmed.');
      setAmount('');
      invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not request withdrawal');
    } finally {
      setSubmitting(false);
    }
  };

  if (summaryQuery.isLoading) {
    return (
      <AppLayout showHeader={false} safeTop={false}>
        <div className="p-4 space-y-3">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-48 w-full" />
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
          <div>
            <h1 className="text-xl font-bold">{isPortfolio ? 'Seller Wallet · All stores' : 'Seller Wallet'}</h1>
            <p className="text-[11px] text-muted-foreground">Payable earnings from settlements — not Settled GMV</p>
          </div>
        </div>
      </SafeHeader>

      <div className="p-4 space-y-4">
        {sellerProfiles.length > 1 && (
          <div className="space-y-2">
            <SellerSwitcher />
            {isPortfolio && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <LayoutGrid size={12} />
                Wallet totals are summed across stores you own
              </p>
            )}
          </div>
        )}

        {summaryQuery.isError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Wallet totals could not be loaded. Refresh to try again — incomplete numbers are not shown.
          </div>
        )}

        <SellerTransferBanner sellerId={statsKey} portfolioIds={isPortfolio ? portfolioIds : null} available={finance?.available || 0} />

        <div className="grid grid-cols-2 gap-3">
          <WalletCard label="Total earned" value={formatPrice(finance?.totalEarned || 0)} hint="Net settlements created" />
          <WalletCard label="Available" value={formatPrice(finance?.available || 0)} hint="Online, eligible to withdraw" emphasis />
          <WalletCard label="Pending" value={formatPrice((finance?.pending || 0) + (finance?.reserved || 0))} hint="Holding or processing" />
          <WalletCard label="On hold" value={formatPrice(finance?.onHold || 0)} />
          <WalletCard label="Paid out" value={formatPrice(finance?.paidOut || 0)} hint="Requires a transfer reference" />
          <WalletCard label="Refunded" value={formatPrice(finance?.refunded || 0)} />
        </div>

        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-3 space-y-1">
            <p className="text-sm font-medium">COD collected — not withdrawable</p>
            <p className="text-lg font-bold tabular-nums">{formatPrice(finance?.codCollected || 0)}</p>
            <p className="text-[11px] text-muted-foreground">
              Cash on delivery was collected by you in cash. Sociva does not hold it and it never becomes Available.
              {finance?.codExpected ? ` Expected / unreconciled: ${formatPrice(finance.codExpected)}.` : ''}
            </p>
          </CardContent>
        </Card>

        <Link to="/seller/earnings" className="block text-sm text-primary font-medium">
          View Settled GMV (completed sales value) →
        </Link>
        <Link to="/seller/payouts" className="block text-sm text-muted-foreground">
          Settlement ledger →
        </Link>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Wallet size={16} />
              <h2 className="font-semibold">Withdraw available earnings</h2>
            </div>
            {isPortfolio ? (
              <p className="text-sm text-muted-foreground">Select one store to request a withdrawal.</p>
            ) : readinessQuery.data?.canRequestWithdrawal ? (
              <>
                <p className="text-xs text-muted-foreground">
                  Only online Available balance can be withdrawn. COD cash cannot.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder={`Up to ${formatPrice(finance?.available || 0)}`}
                  />
                  <Button onClick={requestWithdrawal} disabled={submitting || (finance?.available || 0) <= 0}>
                    Request
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg bg-muted px-3 py-2 text-sm flex items-start gap-2">
                <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                <p>
                  {readinessQuery.data?.reason ||
                    'Withdrawals are not enabled yet. Online earnings stay as Available until Razorpay Route payouts are production-ready.'}
                </p>
              </div>
            )}
            {(withdrawalsQuery.data || []).length > 0 && (
              <div className="space-y-2 pt-2">
                <p className="text-xs font-medium text-muted-foreground">Withdrawal requests</p>
                {(withdrawalsQuery.data || []).map((row: any) => (
                  <div key={row.id} className="flex items-center justify-between text-sm">
                    <span>{formatPrice(Number(row.amount) || 0)}</span>
                    <Badge variant="outline">{row.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div>
          <h2 className="font-semibold mb-2">Wallet history</h2>
          {activityQuery.isError && (
            <p className="text-sm text-destructive mb-2">Activity could not be loaded.</p>
          )}
          {(activityQuery.data || []).length === 0 ? (
            <div className="text-center py-10 bg-muted rounded-xl">
              <Banknote className="mx-auto text-muted-foreground mb-2" size={28} />
              <p className="text-sm text-muted-foreground">No settlement, refund, or COD activity yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(activityQuery.data || []).map((row: any) => {
                const withdrawable = isWithdrawableSource(row.metadata);
                return (
                  <Card key={`${row.type}-${row.id}`}>
                    <CardContent className="p-3 flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{activityLabel(row.type, row.status)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {row.event_at ? format(new Date(row.event_at), 'MMM d, yyyy · h:mm a') : ''}
                          {row.order_id ? ` · Order #${String(row.order_id).slice(0, 8)}` : ''}
                        </p>
                        {!withdrawable && (
                          <p className="text-[11px] text-warning mt-1">Not withdrawable</p>
                        )}
                        {(row.metadata?.provider_transfer_id || row.metadata?.offline_transfer_ref || row.metadata?.transfer_ref) && (
                          <p className="text-[11px] text-muted-foreground">
                            Ref {row.metadata.provider_transfer_id || row.metadata.offline_transfer_ref || row.metadata.transfer_ref}
                          </p>
                        )}
                      </div>
                      <p className="font-semibold tabular-nums">{formatPrice(Number(row.amount) || 0)}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function WalletCard({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={emphasis ? 'border-primary/30' : undefined}>
      <CardContent className="p-3">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          {label === 'Pending' ? <Clock size={11} /> : null}
          {label}
        </p>
        <p className="text-lg font-bold tabular-nums">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
