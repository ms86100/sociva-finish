import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Coins, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSellerCreditActivation, useSellerCreditRealtime } from '@/hooks/queries/useSellerCredits';
import { pickSellerJourneyStore, resolveSellerJourney, type SellerJourney } from '@/lib/seller-journey';

function BannerFrame({
  journey,
  className,
}: {
  journey: SellerJourney;
  className?: string;
}) {
  const Icon =
    journey.kind === 'approved_recharge'
      ? Coins
      : journey.kind === 'rejected'
        ? ShieldCheck
        : Clock;

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 shadow-sm',
        journey.kind === 'approved_recharge' && 'border-primary/20 bg-primary/5',
        journey.kind === 'pending' && 'border-border bg-card',
        journey.kind === 'rejected' && 'border-destructive/20 bg-destructive/5',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
            journey.kind === 'approved_recharge' && 'bg-primary/10 text-primary',
            journey.kind === 'pending' && 'bg-muted text-muted-foreground',
            journey.kind === 'rejected' && 'bg-destructive/10 text-destructive',
          )}
        >
          <Icon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {journey.kind === 'pending' && (
              <CheckCircle2 size={14} className="shrink-0 text-muted-foreground" />
            )}
            <p className="text-sm font-semibold leading-tight">{journey.title}</p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{journey.body}</p>
          {journey.cta && journey.href && (
            <Link to={journey.href}>
              <Button
                size="sm"
                variant={journey.kind === 'pending' ? 'outline' : 'default'}
                className="mt-3 h-8 text-xs"
              >
                {journey.cta}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function SellerJourneyBanner({
  className,
  profiles,
  creditActivated,
}: {
  className?: string;
  profiles?: Parameters<typeof resolveSellerJourney>[0];
  creditActivated?: boolean | null;
}) {
  const { sellerProfiles } = useAuth();
  const source = profiles ?? sellerProfiles;
  const store = pickSellerJourneyStore(source);
  const needsCreditCheck = store?.status === 'approved';
  const activationQuery = useSellerCreditActivation(needsCreditCheck ? store.sellerId : null);
  useSellerCreditRealtime(needsCreditCheck && store ? [store.sellerId] : []);

  const activated = creditActivated ?? (needsCreditCheck ? activationQuery.data : undefined);
  const journey = resolveSellerJourney(source, activated);
  if (journey.kind === 'none') return null;

  return <BannerFrame journey={journey} className={className} />;
}
