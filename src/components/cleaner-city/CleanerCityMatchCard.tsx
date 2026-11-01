// @ts-nocheck
import { Bike, Car, ShieldCheck, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  formatVehicleTitle,
  hostTierLabel,
  matchFitPercent,
  matchReasonChips,
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

function StarRow({ avg, count }: { avg: number; count: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(avg)));
  return (
    <div className="flex items-center gap-1.5" data-testid="cleaner-city-match-stars">
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            size={13}
            className={cn(
              n <= filled ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/35',
            )}
            aria-hidden
          />
        ))}
      </div>
      <span className="text-[11px] font-semibold text-foreground">
        {avg > 0 ? avg.toFixed(1) : 'New'}
      </span>
      {count > 0 ? (
        <span className="text-[11px] text-muted-foreground">({count})</span>
      ) : (
        <span className="text-[11px] text-muted-foreground">first rides</span>
      )}
    </div>
  );
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
  const flat = String(match.host_flat || '').trim();
  const company = String(match.host_company || '').trim();
  const name = String(match.host_name || 'Neighbour').trim() || 'Neighbour';
  const leave = String(match.depart_time || '').slice(0, 5);
  const seats = match.seats_available;
  const isBike = String(match.vehicle_type || '').toLowerCase() === 'bike';
  const VehicleIcon = isBike ? Bike : Car;
  const plate = String(match.vehicle_registration || '')
    .replace(/\s+/g, '')
    .toUpperCase();
  const vehicleTitle = formatVehicleTitle(match);
  const fit = matchFitPercent(match.score);
  const tier = hostTierLabel(completed);

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[22px] border border-border bg-card p-4 space-y-3 transition-all duration-300',
        justRequested && 'border-primary/50 bg-primary/5 scale-[1.01]',
      )}
      data-testid="cleaner-city-match-card"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-primary/15 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-8 bottom-0 h-24 w-24 rounded-full bg-amber-400/10 blur-2xl"
        aria-hidden
      />

      <div className="relative flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-14 w-14 border-2 border-primary/25 shadow-md">
            {match.host_avatar_url ? (
              <AvatarImage src={match.host_avatar_url} alt={name} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-primary/15 text-sm font-extrabold text-primary">
              {initials(name)}
            </AvatarFallback>
          </Avatar>
          <span
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-background bg-[#0D3327] text-[#A3C9A8] shadow"
            title={vehicleKindLabel(match.vehicle_type)}
            data-testid="cleaner-city-match-vehicle-icon"
          >
            <VehicleIcon size={14} aria-hidden />
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold leading-tight tracking-tight">
                {name}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {[company || null, flat ? `Flat ${flat}` : null].filter(Boolean).join(' · ') ||
                  'Verified neighbour'}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-primary">
              {tier}
            </span>
          </div>

          <StarRow avg={starAvg} count={ratingCount} />

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {match.shared_circle ? (
              <span
                className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary"
                data-testid="cleaner-city-shared-circle-badge"
              >
                Circle
              </span>
            ) : null}
            {match.host_vehicle_verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                <ShieldCheck size={11} aria-hidden />
                Docs OK
              </span>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              {completed} ride{completed === 1 ? '' : 's'} done
            </span>
          </div>
        </div>
      </div>

      <div className="relative rounded-2xl border border-primary/20 bg-[#0D3327]/90 px-3.5 py-3 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#A3C9A8]">
              {vehicleKindLabel(match.vehicle_type)}
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug">{vehicleTitle}</p>
            {plate ? (
              <p
                className="mt-2 inline-flex rounded-md border border-white/20 bg-black/25 px-2 py-1 font-mono text-[12px] font-bold tracking-[0.18em] text-[#A3C9A8]"
                data-testid="cleaner-city-match-plate"
              >
                {plate}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-white/55">Plate not added yet</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-extrabold leading-none">{leave || '--:--'}</p>
            <p className="mt-1 text-[11px] text-white/70">
              {seats != null ? `${seats} seat${seats === 1 ? '' : 's'}` : 'Seats'}
            </p>
          </div>
        </div>
        <p className="mt-2.5 text-xs text-white/70">
          {match.origin_label} → {match.destination_label}
        </p>
      </div>

      <div className="relative space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-primary">
            Match power
          </p>
          <p className="text-[11px] font-bold text-foreground" data-testid="cleaner-city-match-fit">
            {fit}%
          </p>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-500"
            style={{ width: `${fit}%` }}
          />
        </div>
        {chips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-border/80 bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <Button
        className="relative h-12 w-full text-base font-extrabold shadow-md shadow-primary/20"
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
              : 'Request seat'}
      </Button>
    </div>
  );
}
