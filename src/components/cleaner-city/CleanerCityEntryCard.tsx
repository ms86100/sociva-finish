// @ts-nocheck
import { Link } from 'react-router-dom';
import { Car, MapPin, Navigation } from 'lucide-react';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useMyRides } from '@/hooks/queries/useCleanerCity';
import { firstName, rideStatusLabel } from '@/lib/cleaner-city/rideMissionCopy';
import { useAuth } from '@/contexts/AuthContext';
import { hapticSelection } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const ACTIVE = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];

/**
 * Account entry for sociva Ride. Same simple card pattern as Help Recommendation.
 * Hidden unless society feature is enabled. Active rides deep-link into the mission.
 */
export function CleanerCityEntryCard({ className }: { className?: string }) {
  const { isFeatureEnabled, isLoading } = useEffectiveFeatures();
  const enabled = !isLoading && isFeatureEnabled('cleaner_city');
  const { user } = useAuth();
  const { data: rides = [] } = useMyRides();

  if (!enabled) return null;

  const active =
    rides.find((r) => ACTIVE.includes(r.status)) || null;
  const isHost = active && active.host_user_id === user?.id;
  const partner = active
    ? firstName(isHost ? active.guest_name : active.host_name)
    : null;

  if (active) {
    return (
      <section
        className={cn('px-4 pt-4 pb-2', className)}
        data-testid="account-sociva-ride-section"
        aria-label="sociva Ride - continue active commute"
      >
        <div className="helphub-entry-shell rounded-[22px] p-[1.5px]">
          <Link
            to={`/cleaner-city/ride/${active.id}`}
            data-testid="cleaner-city-entry-card"
            onClick={() => hapticSelection()}
            className="relative block overflow-hidden rounded-[20.5px] bg-card px-3.5 py-3.5 shadow-card active:scale-[0.99] transition-transform"
          >
            <div
              className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
              aria-hidden
            />
            <div className="relative flex items-start gap-2.5">
              <div className="h-9 w-9 rounded-xl bg-primary/12 flex items-center justify-center shrink-0">
                <Car className="text-primary" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold tracking-tight text-foreground">
                    sociva Ride
                  </h3>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  </span>
                </div>
                <p className="text-[13px] font-bold text-foreground mt-0.5 leading-snug">
                  {isHost ? `Hosting ${partner}` : `Riding with ${partner}`}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                  {rideStatusLabel(active.status)} - tap to continue
                </p>
              </div>
            </div>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn('px-4 pt-4 pb-2', className)}
      data-testid="account-sociva-ride-section"
      aria-label="sociva Ride - find or offer a commute seat"
    >
      <div className="helphub-entry-shell rounded-[22px] p-[1.5px]">
        <div
          data-testid="cleaner-city-entry-card"
          className="relative overflow-hidden rounded-[20.5px] bg-card px-3.5 py-3.5 shadow-card"
        >
          <div
            className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-primary/10 blur-2xl"
            aria-hidden
          />
          <div className="relative flex items-start gap-2.5 mb-3">
            <div className="h-9 w-9 rounded-xl bg-primary/12 flex items-center justify-center shrink-0">
              <Car className="text-primary" size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-extrabold tracking-tight text-foreground">
                sociva Ride
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                Find a seat or offer one for your daily office run
              </p>
            </div>
          </div>

          <div className="relative grid grid-cols-2 gap-2.5">
            <Link
              to="/cleaner-city"
              onClick={() => hapticSelection()}
              data-testid="sociva-ride-find"
              className="group flex flex-col items-start gap-1.5 rounded-2xl border border-primary/25 bg-primary/8 px-3 py-3 active:scale-[0.98] transition-transform"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <MapPin size={15} strokeWidth={2.4} />
              </span>
              <span className="text-[13px] font-bold text-foreground leading-tight">
                Find a ride
              </span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                Match nearby seats
              </span>
            </Link>

            <Link
              to="/cleaner-city/offer"
              onClick={() => hapticSelection()}
              data-testid="sociva-ride-offer"
              className="group flex flex-col items-start gap-1.5 rounded-2xl border border-border bg-background/80 px-3 py-3 active:scale-[0.98] transition-transform hover:border-primary/30"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-foreground">
                <Navigation size={15} strokeWidth={2.4} />
              </span>
              <span className="text-[13px] font-bold text-foreground leading-tight">
                Offer a seat
              </span>
              <span className="text-[10px] text-muted-foreground leading-snug">
                Share your commute
              </span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
