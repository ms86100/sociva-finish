// @ts-nocheck
import { Link } from 'react-router-dom';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useMyRides } from '@/hooks/queries/useCleanerCity';
import { firstName, rideStatusLabel } from '@/lib/cleaner-city/rideMissionCopy';
import { useAuth } from '@/contexts/AuthContext';

const ACTIVE = ['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'];

/**
 * Home + Book entry for A Cleaner City. Hidden unless society feature is enabled.
 * When a ride mission is live, deep-links straight into it.
 */
export function CleanerCityEntryCard() {
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
      <Link
        to={`/cleaner-city/ride/${active.id}`}
        data-testid="cleaner-city-entry-card"
        className="mx-4 mt-2.5 block overflow-hidden rounded-[26px] border border-[#A3C9A8]/35 bg-[#0D3327] px-4 py-4 text-left text-white shadow-[0_22px_48px_-24px_rgba(13,51,39,0.95)] transition-transform active:scale-[0.99]"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-extrabold tracking-tight text-white">sociva</p>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#A3C9A8]/20 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#A3C9A8]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/80" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Live mission
          </span>
        </div>
        <p className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-[#A3C9A8]">
          {isHost ? `Hosting ${partner}` : `Riding with ${partner}`}
        </p>
        <p className="mt-1.5 text-[13px] font-medium text-white/85">
          {rideStatusLabel(active.status)} - tap to open your ride
        </p>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7BA88A]">
          Continue mission
        </p>
      </Link>
    );
  }

  return (
    <Link
      to="/cleaner-city"
      data-testid="cleaner-city-entry-card"
      className="mx-4 mt-2.5 block overflow-hidden rounded-[26px] border border-white/10 bg-[#0D3327] px-4 py-4 text-left text-white shadow-[0_22px_48px_-24px_rgba(13,51,39,0.95)] transition-transform active:scale-[0.99]"
    >
      <p className="text-[11px] font-extrabold tracking-tight text-white">sociva</p>
      <p className="mt-1 text-[22px] font-extrabold leading-tight tracking-tight text-[#A3C9A8]">
        A Cleaner City
      </p>
      <p className="mt-1.5 max-w-[18rem] text-[13px] font-medium text-white/90">
        Find a seat or offer one for your daily office run.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="inline-flex items-center rounded-full bg-[#144536] px-2.5 py-1 text-[11px] font-bold text-[#A3C9A8] ring-1 ring-white/5">
          Find a ride
        </span>
        <span className="inline-flex items-center rounded-full bg-[#144536] px-2.5 py-1 text-[11px] font-bold text-[#A3C9A8] ring-1 ring-white/5">
          Offer a seat
        </span>
      </div>
      <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7BA88A]">
        Open commute
      </p>
    </Link>
  );
}
