// @ts-nocheck
import { BadgeCheck, Fuel, Home, Info, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  formatFuelShareRupees,
  formatLeaveClock,
  formatVehicleTitle,
  matchReasonChips,
  vehicleKindLabel,
} from '@/lib/cleaner-city/matchCopy';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { cn } from '@/lib/utils';
import type { MatchResult } from '@/hooks/queries/useCleanerCity';

type Props = {
  match: MatchResult;
  requesting?: boolean;
  justRequested?: boolean;
  locked?: boolean;
  onRequest: () => void;
  /** Open pre-request ride details. */
  onOpenDetails?: () => void;
  /** Compact nearby strip on Home */
  compact?: boolean;
};

function initials(name?: string | null) {
  const parts = String(name || 'R').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'R';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function firstName(name?: string | null) {
  return String(name || '').trim().split(/\s+/)[0] || 'Neighbour';
}

function societyFromMatch(match: MatchResult) {
  const society = String((match as { host_society?: string }).host_society || '').trim();
  if (society) return society;
  const flat = String(match.host_flat || '').trim();
  const company = String(match.host_company || '').trim();
  if (flat) return `Flat ${flat}`;
  if (company) return company;
  return 'Neighbour society';
}

/**
 * Find / Home match card.
 * Data comes from live find_matches results.
 */
export function CleanerCityMatchCard({
  match,
  requesting,
  justRequested,
  locked,
  onRequest,
  onOpenDetails,
  compact,
}: Props) {
  const name = String(match.host_name || 'Neighbour').trim() || 'Neighbour';
  const leaveClock = formatLeaveClock(match.depart_time);
  const seats = Number(match.seats_available) || 0;
  const vehicleTitle = formatVehicleTitle(match);
  const kindLabel = vehicleKindLabel(match.vehicle_type);
  const reasonChips = matchReasonChips(match.reasons || [], 3);
  const fuelRs = formatFuelShareRupees(match.estimated_fuel_paise);
  const detour =
    match.estimated_detour_minutes != null && Number.isFinite(Number(match.estimated_detour_minutes))
      ? `Detour +${Math.max(0, Math.round(Number(match.estimated_detour_minutes)))} min`
      : null;
  const society = societyFromMatch(match);
  const verified = !!match.host_vehicle_verified || !!match.host_company;

  if (compact) {
    return (
      <article
        className={cn(cc.card, 'p-4')}
        data-testid="cleaner-city-match-card"
        data-publication-id={match.publication_id}
      >
        <div
          className={cn('flex items-start gap-3', onOpenDetails && 'cursor-pointer')}
          role={onOpenDetails ? 'button' : undefined}
          tabIndex={onOpenDetails ? 0 : undefined}
          onClick={onOpenDetails}
          onKeyDown={
            onOpenDetails
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenDetails();
                  }
                }
              : undefined
          }
        >
          <Avatar className="h-12 w-12 shrink-0">
            {match.host_avatar_url ? (
              <AvatarImage src={match.host_avatar_url} alt="" className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-[#E8F2EC] text-sm font-semibold text-[#0F3D2E]">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-[15px] font-semibold">
                  {firstName(name)}
                  {verified ? (
                    <BadgeCheck className="h-4 w-4 shrink-0 text-[#0F3D2E]" aria-label="Verified" />
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{society}</p>
              </div>
              <span className="shrink-0 text-[12px] font-semibold text-[#0F3D2E]">
                {`${seats} seat${seats === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#0F3D2E]" />
              {match.origin_label} → {match.destination_label}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {leaveClock || '--:--'}
              {fuelRs != null ? ` · Fuel share · Rs ${fuelRs}` : ''}
            </p>
          </div>
        </div>
        <Button
          className={cn(cc.primaryBtn, 'mt-3 w-full')}
          disabled={requesting || justRequested || locked || seats < 1}
          onClick={onRequest}
          data-testid="cleaner-city-request-seat"
        >
          {justRequested ? 'Requested' : requesting ? 'Requesting…' : 'Request seat'}
        </Button>
      </article>
    );
  }

  return (
    <article
      className={cn(cc.card, 'overflow-hidden p-4')}
      data-testid="cleaner-city-match-card"
      data-publication-id={match.publication_id}
    >
      <div
        className={cn('flex items-start gap-3', onOpenDetails && 'cursor-pointer')}
        role={onOpenDetails ? 'button' : undefined}
        tabIndex={onOpenDetails ? 0 : undefined}
        onClick={onOpenDetails}
        onKeyDown={
          onOpenDetails
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenDetails();
                }
              }
            : undefined
        }
      >
        <Avatar className="h-14 w-14 shrink-0">
          {match.host_avatar_url ? (
            <AvatarImage src={match.host_avatar_url} alt="" className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-[#E8F2EC] text-sm font-semibold text-[#0F3D2E]">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[16px] font-semibold text-foreground">{firstName(name)}</p>
            {verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#E8F2EC] px-2 py-0.5 text-[10px] font-semibold text-[#0F3D2E]">
                <BadgeCheck className="h-3 w-3" />
                verified
              </span>
            ) : null}
            {match.shared_circle ? (
              <span
                className="inline-flex rounded-full bg-[#E8F2EC] px-2 py-0.5 text-[10px] font-semibold text-[#0F3D2E]"
                data-testid="cleaner-city-shared-circle-badge"
              >
                Trusted circle
              </span>
            ) : null}
            {match.trip_kind === 'extra' ? (
              <span
                className="inline-flex rounded-full bg-[#F7F5F1] px-2 py-0.5 text-[10px] font-semibold text-[#0F3D2E]"
                data-testid="cleaner-city-extra-trip-badge"
              >
                Extra trip
              </span>
            ) : null}
            <span className="ml-auto rounded-full bg-[#E8F2EC] px-2.5 py-0.5 text-[11px] font-semibold text-[#0F3D2E]">
              {`${seats} seat${seats === 1 ? '' : 's'} left`}
            </span>
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Home className="h-3.5 w-3.5" />
            {society}
          </p>
          {match.vehicle_registration ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="cleaner-city-match-plate">
              {match.vehicle_registration}
            </p>
          ) : null}
          {match.host_avg_stars != null && Number(match.host_avg_stars) > 0 ? (
            <p
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F3D2E]"
              data-testid="cleaner-city-match-stars"
            >
              <Star className="h-3 w-3 fill-[#0F3D2E] text-[#0F3D2E]" />
              {Number(match.host_avg_stars).toFixed(1)}
              {match.host_rating_count ? (
                <span className="font-normal text-muted-foreground">
                  ({match.host_rating_count})
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>

      {Array.isArray(match.reason_labels) && match.reason_labels.length > 0 ? (
        <details className="mt-3 rounded-xl bg-[#F7F5F1] px-3 py-2" data-testid="cleaner-city-match-why">
          <summary className="cursor-pointer text-[12px] font-semibold text-[#0F3D2E]">
            Why this ride
          </summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {match.reason_labels.slice(0, 4).map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {match.on_route_drop ? (
        <p
          className="mt-2 text-[11px] font-semibold text-[#0F3D2E]"
          data-testid="cleaner-city-on-route-drop"
        >
          Drop mid-route
        </p>
      ) : null}

      <div className="relative mt-4 space-y-3 pl-1">
        <div className="absolute bottom-2 left-[7px] top-2 w-px bg-[#0F3D2E]/25" aria-hidden />
        <div className="relative flex items-start gap-3">
          <span className="relative z-[1] mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#0F3D2E]" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">{match.origin_label || 'Pickup'}</p>
            <p className="text-[12px] text-muted-foreground">Leave {leaveClock || '--:--'}</p>
          </div>
        </div>
        <div className="relative flex items-start gap-3">
          <span className="relative z-[1] mt-1 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[#0F3D2E] bg-white" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">{match.destination_label || 'Destination'}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        {vehicleTitle ? <span>{vehicleTitle}</span> : kindLabel ? <span>{kindLabel}</span> : null}
        {detour ? <span>{detour}</span> : null}
      </div>
      {reasonChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {reasonChips.map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-[#E8F2EC] px-2 py-0.5 text-[10px] font-semibold text-[#0F3D2E]"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-black/5 pt-3">
        <div>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
            Fuel contribution
            <Info className="h-3 w-3" aria-hidden />
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[20px] font-semibold text-[#0F3D2E]">
            <Fuel className="h-4 w-4" />
            {fuelRs != null ? `Rs ${fuelRs}` : '—'}
          </p>
        </div>
      </div>

      <Button
        className={cn(cc.primaryBtn, 'mt-3 w-full')}
        disabled={requesting || justRequested || locked || seats < 1}
        onClick={onRequest}
        data-testid="cleaner-city-request-seat"
      >
        {justRequested ? 'Requested' : requesting ? 'Requesting…' : 'Request seat →'}
      </Button>
    </article>
  );
}
