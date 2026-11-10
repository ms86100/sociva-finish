// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  BadgeCheck,
  Car,
  Clock,
  Fuel,
  Heart,
  MapPin,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import {
  formatFuelShareRupees,
  formatLeaveClock,
  formatVehicleTitle,
} from '@/lib/cleaner-city/matchCopy';
import { useRequestRide, type MatchResult } from '@/hooks/queries/useCleanerCity';
import { cn } from '@/lib/utils';

function initials(name?: string | null) {
  const parts = String(name || 'R').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'R';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function societyLabel(match: MatchResult) {
  const society = String((match as { host_society?: string }).host_society || '').trim();
  if (society) return society;
  const flat = String(match.host_flat || '').trim();
  if (flat) return `Flat ${flat}`;
  if (match.host_company) return String(match.host_company);
  return 'Neighbour society';
}

/**
 * Pre-request ride details. Live request goes through request_ride RPC.
 */
export default function CleanerCityMatchDetailsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const requestRide = useRequestRide();
  const [requesting, setRequesting] = useState(false);

  const state = (location.state || {}) as {
    match?: MatchResult;
    publicationId?: string;
    guestPickup?: { lat: number; lng: number };
    guestDest?: { lat: number; lng: number };
  };

  const match = useMemo(() => state.match || null, [state.match]);

  if (!match) {
    return (
      <CleanerCityChrome headerTitle="Ride details" className={cc.bg} backTo="/cleaner-city/find">
        <CleanerCityGate>
          <div className={cn(cc.page, 'text-center')}>
            <p className="text-sm text-muted-foreground">Ride not found.</p>
            <Link to="/cleaner-city/find" className="mt-3 inline-block font-semibold text-[#0F3D2E]">
              Back to Find
            </Link>
          </div>
        </CleanerCityGate>
      </CleanerCityChrome>
    );
  }

  const name = String(match.host_name || 'Neighbour').trim();
  const leave = formatLeaveClock(match.depart_time);
  const vehicle = formatVehicleTitle(match);
  const fuelRs = formatFuelShareRupees(match.estimated_fuel_paise);
  const seats = Number(match.seats_available) || 0;
  const detour =
    match.estimated_detour_minutes != null
      ? Math.max(0, Math.round(Number(match.estimated_detour_minutes)))
      : null;
  const verified = !!match.host_vehicle_verified || !!match.host_company;
  const stars = match.host_avg_stars != null ? Number(match.host_avg_stars) : null;
  const ridesCount = Number(match.host_completed_rides || match.host_rating_count || 0);

  const requestSeat = async () => {
    if (!state.guestPickup || !state.guestDest) {
      toast.error('Set pickup and destination first');
      navigate('/cleaner-city/find');
      return;
    }
    setRequesting(true);
    try {
      const ride = await requestRide.mutateAsync({
        publication_id: match.publication_id,
        guest_pickup_lat: state.guestPickup.lat,
        guest_pickup_lng: state.guestPickup.lng,
        guest_dest_lat: state.guestDest.lat,
        guest_dest_lng: state.guestDest.lng,
      });
      toast.success('Seat requested');
      if (ride?.id) {
        navigate(`/cleaner-city/ride/${ride.id}`, { state: { seededRide: ride } });
      } else {
        navigate('/cleaner-city/rides');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Could not request seat');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <CleanerCityChrome
      headerTitle="Ride details"
      className={cc.bg}
      backTo="/cleaner-city/find"
      backLabel="Find"
    >
      <CleanerCityGate>
        <div className={cn(cc.page, 'pb-32')} data-testid="cleaner-city-match-details">
          <header className="text-center">
            <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground">
              Ride details
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Before request</p>
          </header>

          <section className={cn(cc.card, 'relative p-4')}>
            <button
              type="button"
              className="absolute right-3 top-3 rounded-full p-2 text-muted-foreground"
              aria-label="Save"
            >
              <Heart className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-3">
              <Avatar className="h-14 w-14">
                {match.host_avatar_url ? (
                  <AvatarImage src={match.host_avatar_url} alt="" className="object-cover" />
                ) : null}
                <AvatarFallback className="bg-[#E8F2EC] font-semibold text-[#0F3D2E]">
                  {initials(name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="flex items-center gap-1 text-[16px] font-semibold">
                  {name}
                  {verified ? (
                    <BadgeCheck className="h-4 w-4 text-[#0F3D2E]" aria-label="Verified" />
                  ) : null}
                </p>
                <p className="text-[12px] text-muted-foreground">{societyLabel(match)}</p>
                {stars != null && stars > 0 ? (
                  <p className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-[#0F3D2E]">
                    <Star className="h-3.5 w-3.5 fill-[#0F3D2E] text-[#0F3D2E]" />
                    {stars.toFixed(1)}
                    {ridesCount ? (
                      <span className="font-normal text-muted-foreground">
                        ({ridesCount} rides)
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          <section className={cn(cc.card, 'p-4')}>
            <div className="relative space-y-4 pl-1">
              <div className="absolute bottom-3 left-[7px] top-3 w-px bg-[#0F3D2E]/25" />
              <div className="relative flex gap-3">
                <span className="relative z-[1] mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#0F3D2E]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] text-muted-foreground">Pickup</p>
                      <p className="text-[14px] font-semibold">{match.origin_label}</p>
                    </div>
                    <p className="text-[12px] font-semibold text-[#0F3D2E]">
                      Leave {leave || '--:--'}
                    </p>
                  </div>
                </div>
              </div>
              <div className="relative flex gap-3">
                <span className="relative z-[1] mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[#0F3D2E] bg-white" />
                <div>
                  <p className="text-[11px] text-muted-foreground">Drop-off</p>
                  <p className="text-[14px] font-semibold">{match.destination_label}</p>
                </div>
              </div>
            </div>
            <p className="mt-3 flex items-center gap-1.5 border-t border-black/5 pt-3 text-[12px] text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-[#0F3D2E]" />
              Usual route
              {match.route_distance_meters
                ? ` · ~${Math.max(1, Math.round(Number(match.route_distance_meters) / 1000))} km`
                : ''}
            </p>
          </section>

          <section className={cn(cc.card, 'flex items-center gap-3 p-4')}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#E8F2EC] text-[#0F3D2E]">
              <Car className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">{vehicle || 'Vehicle'}</p>
              <p className="text-[12px] text-muted-foreground">
                {seats} seat{seats === 1 ? '' : 's'} available
              </p>
            </div>
          </section>

          {detour != null ? (
            <section className={cn(cc.card, 'p-4')}>
              <p className="flex items-center gap-2 text-[14px] font-semibold">
                <Clock className="h-4 w-4 text-[#0F3D2E]" />
                Detour about {detour} min
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Minor detour to pick you up on the way.
              </p>
            </section>
          ) : null}

          <section className={cn(cc.card, 'flex items-center gap-3 p-4')}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EDE4D8] text-[#5C4033]">
              <Fuel className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold">
                Fuel contribution{fuelRs != null ? ` Rs ${fuelRs}` : ''}
              </p>
              <p className="text-[12px] text-muted-foreground">Transparent note · Covers fuel only.</p>
            </div>
          </section>

          <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-black/5 bg-[#F7F5F1]/95 px-4 py-3 backdrop-blur">
            <div className="mx-auto flex w-full max-w-lg flex-col gap-2">
              <button
                type="button"
                className={cn(cc.primaryBtn, 'w-full')}
                disabled={requesting || seats < 1}
                onClick={() => void requestSeat()}
                data-testid="cleaner-city-match-details-request"
              >
                {requesting ? 'Requesting…' : 'Request seat'}
              </button>
              <button
                type="button"
                className={cn(cc.secondaryBtn, 'w-full')}
                onClick={() => navigate(-1)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
