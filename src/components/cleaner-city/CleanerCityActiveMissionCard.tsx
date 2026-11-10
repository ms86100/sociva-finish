// @ts-nocheck
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  firstName,
  formatDepartTime,
  rideStatusLabel,
  RIDE_MISSION_STEPS,
  stepIndex,
} from '@/lib/cleaner-city/rideMissionCopy';
import { guestDropRankFromOrder } from '@/lib/cleaner-city/dropRun';
import { cn } from '@/lib/utils';

type RideLike = {
  id: string;
  status: string;
  travel_date?: string | null;
  host_user_id?: string | null;
  guest_user_id?: string | null;
  depart_time?: string | null;
  origin_label?: string | null;
  destination_label?: string | null;
  host_name?: string | null;
  guest_name?: string | null;
  host_avatar_url?: string | null;
  guest_avatar_url?: string | null;
  drop_order_json?: unknown;
};

type Props = {
  ride: RideLike;
  myUserId?: string | null;
  todayIso: string;
  className?: string;
};

function initials(name?: string | null) {
  const parts = String(name || 'R').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'R';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function CleanerCityActiveMissionCard({ ride, myUserId, todayIso, className }: Props) {
  const isHost = ride.host_user_id === myUserId;
  const partnerName = isHost ? ride.guest_name : ride.host_name;
  const partnerAvatar = isHost ? ride.guest_avatar_url : ride.host_avatar_url;
  const partner = firstName(partnerName) || 'Neighbour';
  const leave = formatDepartTime(ride.depart_time);
  const when = ride.travel_date === todayIso ? 'Today' : ride.travel_date || 'Ride';
  const idx = stepIndex(ride.status);
  const known = RIDE_MISSION_STEPS.includes(ride.status as (typeof RIDE_MISSION_STEPS)[number]);
  const progress = known
    ? ((idx + 1) / RIDE_MISSION_STEPS.length) * 100
    : ride.status === 'disputed' || ride.status === 'safety_incident'
      ? 100
      : 20;
  const dropRank = !isHost ? guestDropRankFromOrder(ride.drop_order_json, ride.id) : null;

  return (
    <Link
      to={`/cleaner-city/ride/${ride.id}`}
      className={cn(
        'relative block overflow-hidden rounded-[24px] border border-[#A3C9A8]/45 bg-[#0D3327] p-4 text-white shadow-[0_20px_40px_-28px_rgba(163,201,168,0.85)] transition-transform active:scale-[0.99]',
        className,
      )}
      data-testid="cleaner-city-active-ride-link"
    >
      <div
        className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-[#A3C9A8]/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-8 top-0 h-16 w-16 animate-pulse rounded-full bg-[#A3C9A8]/15 blur-2xl"
        aria-hidden
      />

      <div className="relative flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="h-14 w-14 border-2 border-[#A3C9A8]/50 shadow-lg">
            {partnerAvatar ? (
              <AvatarImage src={partnerAvatar} alt={partner} className="object-cover" />
            ) : null}
            <AvatarFallback className="bg-[#A3C9A8]/20 text-sm font-extrabold text-[#A3C9A8]">
              {initials(partnerName)}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#0D3327] bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#A3C9A8]">
              Live mission
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#A3C9A8] px-2 py-0.5 text-[10px] font-extrabold text-[#0D3327]">
              Open
              <ChevronRight size={12} aria-hidden />
            </span>
          </div>
          <p className="mt-1 truncate text-lg font-extrabold leading-tight">
            {isHost ? `Hosting ${partner}` : `Riding with ${partner}`}
          </p>
          <p className="mt-0.5 text-xs text-white/70">
            {when}
            {leave ? ` · leaves ${leave}` : ''}
            {' · '}
            {rideStatusLabel(ride.status)}
          </p>
          {dropRank ? (
            <span
              className="mt-1.5 inline-flex rounded-full bg-[#A3C9A8]/20 px-2 py-0.5 text-[10px] font-extrabold text-[#A3C9A8]"
              data-testid="cleaner-city-mission-drop-chip"
            >
              Drop {dropRank.n} of {dropRank.m}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative mt-3.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-white/60">
          <span>
            Step {Math.min(idx + 1, RIDE_MISSION_STEPS.length)} of {RIDE_MISSION_STEPS.length}
          </span>
          <span className="text-[#A3C9A8]">Tap to continue</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#7BA88A] to-[#A3C9A8] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        {(ride.origin_label || ride.destination_label) && (
          <p className="truncate pt-0.5 text-[11px] text-white/55">
            {ride.origin_label || 'Pickup'} → {ride.destination_label || 'Drop'}
          </p>
        )}
      </div>
    </Link>
  );
}

/** Compact floating shortcut above bottom nav. */
export function CleanerCityActiveMissionDock({
  ride,
  myUserId,
}: {
  ride: RideLike;
  myUserId?: string | null;
}) {
  const isHost = ride.host_user_id === myUserId;
  const partner = firstName(isHost ? ride.guest_name : ride.host_name) || 'Neighbour';
  const dropRank = !isHost ? guestDropRankFromOrder(ride.drop_order_json, ride.id) : null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      style={{
        bottom:
          'calc(4.75rem + max(var(--app-safe-bottom, 0px), env(safe-area-inset-bottom, 0px)))',
      }}
      data-testid="cleaner-city-active-ride-dock"
    >
      <Link
        to={`/cleaner-city/ride/${ride.id}`}
        className="pointer-events-auto flex max-w-sm flex-1 items-center gap-2.5 rounded-full border border-[#A3C9A8]/40 bg-[#0D3327]/95 px-3.5 py-2.5 text-white shadow-[0_12px_40px_-12px_rgba(13,51,39,0.95)] backdrop-blur-md transition-transform active:scale-[0.98]"
      >
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          Mission with {partner}
          <span className="text-white/60"> · {rideStatusLabel(ride.status)}</span>
          {dropRank ? (
            <span className="text-[#A3C9A8]" data-testid="cleaner-city-dock-drop-chip">
              {' '}
              · Drop {dropRank.n} of {dropRank.m}
            </span>
          ) : null}
        </span>
        <ChevronRight size={16} className="shrink-0 text-[#A3C9A8]" aria-hidden />
      </Link>
    </div>
  );
}
