// @ts-nocheck
import { Star } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { RideMission } from '@/hooks/queries/useCleanerCity';
import {
  firstName,
  formatCountdown,
  formatDepartTime,
  rideStatusLabel,
  stepIndex,
  RIDE_MISSION_STEPS,
} from '@/lib/cleaner-city/rideMissionCopy';
import { guestDropRankFromOrder } from '@/lib/cleaner-city/dropRun';
import { cn } from '@/lib/utils';

type Props = {
  ride: RideMission;
  isHost: boolean;
  avgStars?: number | null;
  ratingCount?: number | null;
  completedRides?: number | null;
  celebrate?: boolean;
};

function initials(name?: string | null) {
  const parts = String(name || 'N').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'N';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function RideMissionHero({
  ride,
  isHost,
  avgStars,
  ratingCount,
  completedRides,
  celebrate,
}: Props) {
  const idx = stepIndex(ride.status);
  const progress = ((idx + 1) / RIDE_MISSION_STEPS.length) * 100;
  const leave = formatDepartTime(ride.depart_time);
  const deadline =
    ride.status === 'requested'
      ? formatCountdown(ride.request_expires_at)
      : ride.status === 'pickup_pending' || ride.status === 'confirmed'
        ? formatCountdown(ride.pickup_deadline_at)
        : null;
  const flat = String(ride.partner_flat || '').trim();
  const company = String(ride.partner_company || '').trim();
  const name = ride.partner_name || 'Neighbour';
  const dropRank = !isHost ? guestDropRankFromOrder(ride.drop_order_json, ride.id) : null;
  const hostDropCount =
    isHost && Array.isArray((ride.drop_order_json as { ordered?: unknown[] } | null)?.ordered)
      ? ((ride.drop_order_json as { ordered: unknown[] }).ordered.length || 0)
      : 0;

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-[24px] border border-[#A3C9A8]/40 bg-[#0D3327] p-4 text-white transition-transform duration-500',
        celebrate && 'scale-[1.01]',
      )}
      data-testid="cleaner-city-ride-mission-hero"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-[#A3C9A8]/20 blur-3xl"
        aria-hidden
      />
      <div className="relative flex items-start gap-3">
        <Avatar className="h-16 w-16 border-2 border-[#A3C9A8]/50 shadow-lg">
          {ride.partner_avatar_url ? (
            <AvatarImage src={ride.partner_avatar_url} alt={name} className="object-cover" />
          ) : null}
          <AvatarFallback className="bg-[#A3C9A8]/25 text-base font-extrabold text-[#A3C9A8]">
            {initials(name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-[#A3C9A8]">
            {isHost ? 'Your guest' : 'Your host'}
          </p>
          <h1 className="truncate text-xl font-extrabold leading-tight">{name}</h1>
          <p className="mt-0.5 text-xs text-white/70">
            {[company || null, flat ? `Flat ${flat}` : null].filter(Boolean).join(' · ') ||
              'Verified neighbour'}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/75">
            {avgStars != null && Number(avgStars) > 0 ? (
              <span className="inline-flex items-center gap-1 font-semibold text-white">
                <Star size={12} className="fill-amber-300 text-amber-300" />
                {Number(avgStars).toFixed(1)}
                {ratingCount ? (
                  <span className="font-normal text-white/60">({ratingCount})</span>
                ) : null}
              </span>
            ) : (
              <span>New on Cleaner City</span>
            )}
            <span>
              {Number(completedRides) || 0} ride
              {Number(completedRides) === 1 ? '' : 's'} done
            </span>
          </div>
        </div>
      </div>

      <div className="relative mt-4 rounded-2xl bg-white/5 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[#A3C9A8] px-2.5 py-1 text-[11px] font-extrabold text-[#0D3327]">
            {rideStatusLabel(ride.status)}
          </span>
          {dropRank ? (
            <span
              className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-extrabold text-[#A3C9A8]"
              data-testid="cleaner-city-hero-drop-chip"
            >
              Drop {dropRank.n} of {dropRank.m}
            </span>
          ) : null}
          {hostDropCount > 0 ? (
            <span
              className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-extrabold text-[#A3C9A8]"
              data-testid="cleaner-city-hero-host-drops"
            >
              {hostDropCount} guest drop{hostDropCount === 1 ? '' : 's'}
            </span>
          ) : null}
          {leave ? (
            <span className="text-xs font-semibold text-white/90">Leaves {leave}</span>
          ) : null}
          {deadline ? (
            <span className="text-[11px] font-semibold text-amber-200">{deadline}</span>
          ) : null}
        </div>
        <p className="mt-2 text-sm font-semibold leading-snug">
          {ride.origin_label || 'Pickup'} → {ride.destination_label || 'Drop'}
        </p>
        <p className="mt-1 text-[11px] text-white/65">
          {ride.travel_date}
          {ride.direction === 'to_home' ? ' · To home' : ' · To office'}
          {' · '}
          {isHost ? 'You are hosting' : 'You are riding'}
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#A3C9A8] transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-white/60">
          Mission step {Math.min(idx + 1, RIDE_MISSION_STEPS.length)} of {RIDE_MISSION_STEPS.length}
          {' · '}
          with {firstName(name)}
        </p>
      </div>
    </section>
  );
}
