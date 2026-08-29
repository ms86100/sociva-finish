import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Coins, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSellerCreditActivation, useSellerCreditRealtime } from '@/hooks/queries/useSellerCredits';
import { useLatestActionNotification } from '@/hooks/queries/useNotifications';
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
            {journey.kind === 'approved_recharge' && (
              <CheckCircle2 size={14} className="shrink-0 text-primary" />
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

/**
 * Keep auth sellerProfiles fresh while a store is under review / awaiting credits.
 * Auth realtime often goes CLOSED on long sessions — poll + notification hooks cover that.
 */
function useSellerJourneyLiveRefresh(hasOpenJourney: boolean) {
  const { user, refreshProfile } = useAuth();
  const { data: notification } = useLatestActionNotification(user?.id);

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`seller-journey-banner-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'seller_profiles',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void refreshProfile();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user?.id, refreshProfile]);

  // When admin approves/rejects, the inbox notification often arrives before auth state updates
  useEffect(() => {
    if (!notification?.type) return;
    if (
      notification.type === 'seller_approved' ||
      notification.type === 'seller_rejected' ||
      notification.type === 'seller_suspended' ||
      notification.type === 'seller_credit_purchased'
    ) {
      void refreshProfile();
    }
  }, [notification?.id, notification?.type, refreshProfile]);

  // Fallback while a journey is open (realtime may be degraded)
  useEffect(() => {
    if (!hasOpenJourney || !user?.id) return;
    const tick = () => {
      void refreshProfile();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    const interval = window.setInterval(tick, 12_000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [hasOpenJourney, user?.id, refreshProfile]);
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
  useSellerJourneyLiveRefresh(journey.kind !== 'none' || store?.status === 'pending');

  if (journey.kind === 'none') return null;

  return <BannerFrame journey={journey} className={className} />;
}
