// @ts-nocheck
import { Bike, Car, Footprints, Handshake, Info, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  formatFuelShareRupees,
  formatTripMeters,
  formatVehicleTitle,
  hostTierLabel,
  matchFitPercent,
  matchReasonChips,
  pickupWindowLabel,
  tripLegsFromMatch,
  vehicleKindLabel,
} from '@/lib/cleaner-city/matchCopy';
import { cn } from '@/lib/utils';
import type { MatchResult } from '@/hooks/queries/useCleanerCity';

type Props = {
  match: MatchResult;
  requesting?: boolean;
  justRequested?: boolean;
  locked?: boolean;
  onRequest: () => void;
};

function initials(name?: string | null) {
  const parts = String(name || 'R').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'R';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function firstName(name?: string | null) {
  const part = String(name || '').trim().split(/\s+/)[0];
  return part || 'Neighbour';
}

export function CleanerCityMatchCard({
  match,
  requesting,
  justRequested,
  locked,
  onRequest,
}: Props) {
  const reasons = match.reason_labels || match.reasons || [];
  const chips = matchReasonChips(Array.isArray(reasons) ? reasons : [], 3);
  const avg = Number(match.host_avg_stars);
  const ratingCount = Number(match.host_rating_count) || 0;
  const starAvg = Number.isFinite(avg) && avg > 0 ? avg : 0;
  const completed = Number(match.host_completed_rides) || 0;
  const company = String(match.host_company || '').trim();
  const name = String(match.host_name || 'Neighbour').trim() || 'Neighbour';
  const leave = String(match.depart_time || '').slice(0, 5);
  const windowLabel = pickupWindowLabel(match.depart_time, 5);
  const seats = match.seats_available;
  const isBike = String(match.vehicle_type || '').toLowerCase() === 'bike';
  const VehicleIcon = isBike ? Bike : Car;
  const vehicleTitle = formatVehicleTitle(match);
  const fit = matchFitPercent(match.score);
  const tier = hostTierLabel(completed);
  const fuelRs = formatFuelShareRupees(match.estimated_fuel_paise);
  const legs = tripLegsFromMatch({
    pickup_walk_meters: match.pickup_walk_meters,
    pickup_deviation_meters: match.pickup_deviation_meters,
    route_distance_meters: match.route_distance_meters,
    estimated_detour_minutes: match.estimated_detour_minutes,
    reasons: Array.isArray(match.reasons) ? match.reasons : [],
    extra_stop_meters: match.extra_stop_meters,
  });
  const walkPickupLabel = formatTripMeters(legs.walkPickup);
  const driveLabel = formatTripMeters(legs.drive);
  const walkDropLabel = formatTripMeters(legs.walkDrop);
  const nearbyPickup =
    (Number(legs.walkPickup) >= 0 && Number(legs.walkPickup) <= 800) ||
    chips.some((c) => /nearby pickup|pickup nearby/i.test(c));

  return (
    <article
      className={cn(
        'relative overflow-hidden rounded-[22px] border border-border bg-card p-4 shadow-sm transition-all duration-300',
        justRequested && 'border-primary/50 bg-primary/5 scale-[1.01]',
      )}
      data-testid="cleaner-city-match-card"
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-14 w-14 shrink-0 border border-border shadow-sm">
          {match.host_avatar_url ? (
            <AvatarImage src={match.host_avatar_url} alt={name} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-primary/15 text-sm font-extrabold text-primary">
            {initials(name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[17px] font-extrabold leading-tight tracking-tight text-foreground">
                {firstName(name)}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
                <span className="truncate font-medium text-foreground/80">
                  {company || 'Verified neighbour'}
                </span>
                {match.host_vehicle_verified || company ? (
                  <ShieldCheck
                    size={13}
                    className="shrink-0 text-emerald-500"
                    aria-label="Verified"
                  />
                ) : null}
              </p>
            </div>
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
              title={vehicleKindLabel(match.vehicle_type)}
              data-testid="cleaner-city-match-vehicle-icon"
            >
              <VehicleIcon size={18} aria-hidden />
            </span>
          </div>

          <p className="mt-1.5 text-[13px] font-semibold text-foreground">
            Pickup by {windowLabel || leave || 'time TBD'}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
            {vehicleTitle}
            {match.origin_label ? ` · ${match.origin_label}` : ''}
          </p>
        </div>
      </div>

      <div
        className="mt-3 flex items-center justify-between gap-2 rounded-full border border-border bg-muted/40 px-3 py-2"
        data-testid="cleaner-city-match-trip-strip"
      >
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Footprints size={13} className="shrink-0 text-primary" aria-hidden />
          <span>{walkPickupLabel || 'Walk'}</span>
        </div>
        <span className="text-muted-foreground/50" aria-hidden>
          ·
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold text-foreground">
          <VehicleIcon size={13} className="shrink-0 text-primary" aria-hidden />
          <span>{driveLabel || 'Drive'}</span>
        </div>
        <span className="text-muted-foreground/50" aria-hidden>
          ·
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold text-foreground">
          <Footprints size={13} className="shrink-0 text-primary" aria-hidden />
          <span>{walkDropLabel || 'Walk'}</span>
        </div>
      </div>

      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {match.origin_label || 'Pickup'} → {match.destination_label || 'Drop'}
        {match.estimated_detour_minutes != null
          ? ` · ~${Math.round(Number(match.estimated_detour_minutes))} min detour`
          : ''}
      </p>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            {fuelRs != null ? (
              <>
                <span className="text-[22px] font-extrabold leading-none text-primary">
                  ₹{fuelRs}
                </span>
                <span
                  className="inline-flex items-center text-muted-foreground"
                  title="Estimated fuel share for this seat - not a fare"
                >
                  <Info size={13} aria-hidden />
                </span>
              </>
            ) : (
              <span className="text-[15px] font-extrabold text-foreground">Fuel share TBD</span>
            )}
          </div>
          <p className="mt-1 text-[12px] font-medium text-muted-foreground">
            {seats != null ? `${seats} seat${seats === 1 ? '' : 's'} left` : 'Seats open'}
            {starAvg > 0 ? ` · ${starAvg.toFixed(1)}★` : ''}
            {ratingCount > 0 ? ` (${ratingCount})` : ''}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {tier}
            {completed > 0 ? ` · ${completed} rides done` : ' · new on Cleaner City'}
          </p>
        </div>
      </div>

      <Button
        className="mt-3 h-12 w-full text-base font-extrabold shadow-md shadow-primary/15"
        onClick={onRequest}
        disabled={requesting || justRequested || locked}
        data-testid="cleaner-city-request-seat"
      >
        {locked
          ? 'Open your active ride first'
          : justRequested
            ? 'Request sent · waiting'
            : requesting
              ? 'Sending…'
              : 'Request ride'}
      </Button>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[10px] font-bold text-foreground"
          data-testid="cleaner-city-match-fit"
        >
          <Handshake size={11} className="text-primary" aria-hidden />
          {fit}% match
        </span>
        {nearbyPickup ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[10px] font-bold text-foreground">
            <Footprints size={11} className="text-primary" aria-hidden />
            Nearby pickup
          </span>
        ) : null}
        {match.shared_circle ? (
          <span
            className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary"
            data-testid="cleaner-city-shared-circle-badge"
          >
            Trusted circle
          </span>
        ) : null}
        {chips
          .filter((c) => !/nearby pickup|pickup nearby|seats open/i.test(c))
          .slice(0, 2)
          .map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground"
            >
              {chip}
            </span>
          ))}
      </div>
    </article>
  );
}
