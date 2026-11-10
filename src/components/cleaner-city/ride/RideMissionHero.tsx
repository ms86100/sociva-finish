// @ts-nocheck
import { BadgeCheck, Leaf, Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { RideMission } from '@/hooks/queries/useCleanerCity';
import {
  formatCountdown,
  formatDepartTime,
  rideStatusLabel,
} from '@/lib/cleaner-city/rideMissionCopy';
import { guestDropRankFromOrder } from '@/lib/cleaner-city/dropRun';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { cn } from '@/lib/utils';

type Props = {
  ride: RideMission;
  isHost: boolean;
  avgStars?: number | null;
  ratingCount?: number | null;
  completedRides?: number | null;
  celebrate?: boolean;
  onChat?: () => void;
  onCall?: () => void;
  callBusy?: boolean;
  callAvailable?: boolean;
};

function initials(name?: string | null) {
  const parts = String(name || 'N').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'N';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const STEPS = ['Requested', 'Accepted', 'Confirmed', 'Pickup', 'In progress'] as const;

function stepIndex(status: string) {
  if (status === 'requested') return 0;
  if (status === 'confirmed') return 2;
  if (status === 'pickup_pending') return 3;
  if (status === 'started' || status === 'safety_incident') return 4;
  if (status === 'completed') return 5;
  return 1;
}

export function RideMissionHero({
  ride,
  isHost,
  avgStars,
  ratingCount,
  completedRides,
  celebrate,
}: Props) {
  const leave = formatDepartTime(ride.depart_time);
  const deadline =
    ride.status === 'requested'
      ? formatCountdown(ride.request_expires_at)
      : ride.status === 'pickup_pending'
        ? formatCountdown(ride.pickup_deadline_at)
        : null;
  const flat = String(ride.partner_flat || '').trim();
  const company = String(ride.partner_company || '').trim();
  const society = String(ride.partner_society || '').trim();
  const place = society || (flat ? `Flat ${flat}` : '') || company || 'Neighbour';
  const name = ride.partner_name || 'Neighbour';
  const dropRank = !isHost ? guestDropRankFromOrder(ride.drop_order_json, ride.id) : null;
  const hostDropCount =
    isHost && Array.isArray((ride.drop_order_json as { ordered?: unknown[] } | null)?.ordered)
      ? ((ride.drop_order_json as { ordered: unknown[] }).ordered.length || 0)
      : 0;
  const activeStep = stepIndex(ride.status);
  const confirmedish = ['confirmed', 'pickup_pending', 'started'].includes(ride.status);

  return (
    <section className="space-y-3" data-testid="cleaner-city-ride-mission-hero">
      <div className="flex justify-center">
        <span
          className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0F3D2E] shadow-sm"
          data-testid="cleaner-city-active-ride-pill"
        >
          <span className="h-2 w-2 rounded-full bg-[#0F3D2E]" />
          Active ride
        </span>
      </div>

      <div className={cn('text-center', celebrate && 'scale-[1.01] transition')}>
        <p className="inline-flex items-center gap-1.5 text-[22px] font-semibold tracking-tight">
          {rideStatusLabel(ride.status)}
          {confirmedish ? (
            <BadgeCheck className="h-5 w-5 text-[#0F3D2E]" aria-label="Confirmed" />
          ) : null}
        </p>
        {!isHost && confirmedish ? (
          <p className="mt-1 text-[13px] text-muted-foreground">
            Show this code to your host at pickup.
          </p>
        ) : deadline ? (
          <p className="mt-1 text-[13px] font-semibold text-amber-700">{deadline}</p>
        ) : null}
      </div>

      <div className={cn(cc.card, 'flex items-center gap-3 p-4')}>
        <Avatar className="h-12 w-12">
          {ride.partner_avatar_url ? (
            <AvatarImage src={ride.partner_avatar_url} alt={name} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-[#E8F2EC] text-sm font-semibold text-[#0F3D2E]">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate text-[15px] font-semibold">
            {name.split(/\s+/)[0]}
            {company ? <BadgeCheck className="h-4 w-4 text-[#0F3D2E]" /> : null}
          </p>
          <p className="truncate text-[12px] text-muted-foreground">{place}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
            {avgStars != null && Number(avgStars) > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                {Number(avgStars).toFixed(1)}
              </span>
            ) : (
              <span>New · {Number(completedRides) || 0} rides</span>
            )}
            {ratingCount ? (
              <span className="text-muted-foreground">· {ratingCount} ratings</span>
            ) : null}
            {company ? <span>· Verified partner</span> : null}
          </p>
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
          <Leaf className="h-4 w-4" />
        </span>
      </div>

      <div className={cn(cc.card, 'space-y-3 p-4')}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-2">
            <span className="mt-1.5 h-2 w-2 rounded-full bg-[#0F3D2E]" />
            <div>
              <p className="text-[14px] font-semibold">{ride.origin_label || 'Pickup'}</p>
              <p className="text-[12px] text-muted-foreground">
                {confirmedish ? 'Confirmed' : rideStatusLabel(ride.status)}
                {leave ? ` · Leave ${leave}` : ''}
              </p>
            </div>
          </div>
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {ride.travel_date}
            {leave ? `, ${leave}` : ''}
          </p>
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-2">
            <span className="mt-1.5 h-2 w-2 rounded-full border-2 border-[#0F3D2E]/40 bg-white" />
            <div>
              <p className="text-[14px] font-semibold">{ride.destination_label || 'Drop'}</p>
              <p className="text-[12px] text-muted-foreground">
                {ride.direction === 'to_home' ? 'To home' : 'To office'}
              </p>
            </div>
          </div>
        </div>
        {(dropRank || hostDropCount > 0) && (
          <p className="text-[11px] text-muted-foreground">
            {dropRank
              ? `Drop ${dropRank.n} of ${dropRank.m}`
              : `${hostDropCount} guest drop${hostDropCount === 1 ? '' : 's'}`}
          </p>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-1 overflow-x-auto px-1"
        data-testid="cleaner-city-ride-stepper"
      >
        {STEPS.map((label, i) => {
          const done = i <= activeStep;
          return (
            <div key={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-center">
                {i > 0 ? (
                  <div
                    className={cn(
                      'h-0.5 flex-1',
                      i <= activeStep ? 'bg-[#0F3D2E]' : 'bg-black/10',
                    )}
                  />
                ) : (
                  <div className="flex-1" />
                )}
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    done ? 'bg-[#0F3D2E] text-white' : 'bg-black/10 text-muted-foreground',
                  )}
                >
                  {done ? '✓' : i + 1}
                </span>
                {i < STEPS.length - 1 ? (
                  <div
                    className={cn(
                      'h-0.5 flex-1',
                      i < activeStep ? 'bg-[#0F3D2E]' : 'bg-black/10',
                    )}
                  />
                ) : (
                  <div className="flex-1" />
                )}
              </div>
              <p className="truncate text-[9px] font-medium text-muted-foreground">{label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
