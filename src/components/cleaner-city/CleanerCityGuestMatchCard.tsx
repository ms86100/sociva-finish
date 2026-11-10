// @ts-nocheck
import { BadgeCheck, Bike, Footprints, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatLeaveClock, formatTripMeters } from '@/lib/cleaner-city/matchCopy';
import type { HomeDemoGuest } from '@/lib/cleaner-city/homeDemoGuests';
import { cn } from '@/lib/utils';

type Props = {
  guest: HomeDemoGuest;
  offering?: boolean;
  offered?: boolean;
  onOffer: () => void;
  onDecline?: () => void;
  declining?: boolean;
  /** Live seat request - Accept instead of Offer Ride */
  live?: boolean;
  acceptLabel?: string;
};

function initials(name?: string | null) {
  const parts = String(name || 'G').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function avatarUrl(seed: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

/**
 * HOPR-style guest card for host Find Guests / Accept requests:
 * company + blue tick, walk / ride / walk, fuel, Offer Ride or Accept/Decline.
 */
export function CleanerCityGuestMatchCard({
  guest,
  offering,
  offered,
  onOffer,
  onDecline,
  declining,
  live,
  acceptLabel,
}: Props) {
  const walkPickup = formatTripMeters(guest.walkPickupMeters) || 'Walk';
  const drive = formatTripMeters(guest.driveMeters) || 'Ride';
  const walkDrop = formatTripMeters(guest.walkDropMeters) || 'Walk';
  const busy = offering || declining || offered;
  const photo = guest.avatarUrl || avatarUrl(guest.avatarSeed);

  return (
    <article
      className="rounded-[22px] border border-border bg-card p-4 shadow-sm"
      data-testid="cleaner-city-guest-match-card"
      data-guest-id={guest.id}
      data-live={live ? 'true' : 'false'}
    >
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12 shrink-0">
          <AvatarImage src={photo} alt={guest.guestName} />
          <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
            {initials(guest.guestName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-extrabold text-foreground">
            {guest.guestName}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
            <span className="truncate font-semibold text-sky-700 dark:text-sky-400">
              {guest.companyName || guest.societyOrCompany || 'Verified neighbour'}
            </span>
            {guest.verified || guest.companyName ? (
              <BadgeCheck
                size={15}
                className="shrink-0 text-sky-500"
                aria-label="Work email verified"
                data-testid="cleaner-city-guest-company-verified"
              />
            ) : null}
          </p>
          {guest.societyOrCompany &&
          guest.companyName &&
          guest.societyOrCompany !== guest.companyName ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {guest.societyOrCompany}
            </p>
          ) : null}
          <p
            className="mt-2 text-[13px] font-semibold text-foreground"
            data-testid="cleaner-city-guest-leave-time"
          >
            Leaves at{' '}
            <span className="font-extrabold text-emerald-900 dark:text-emerald-300">
              {formatLeaveClock(guest.wantLeaveTime) || '--:--'}
            </span>
          </p>
          <p className="text-[12px] text-muted-foreground">
            Arrive by{' '}
            <span className="font-bold text-foreground">
              {formatLeaveClock(guest.arriveByTime) || '--:--'}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1 rounded-full border border-border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold">
          <Footprints size={13} className="shrink-0 text-muted-foreground" aria-hidden />
          <span>{walkPickup}</span>
        </div>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold">
          <Bike size={13} className="shrink-0 text-muted-foreground" aria-hidden />
          <span>{drive}</span>
        </div>
        <span className="text-muted-foreground/40" aria-hidden>
          ·
        </span>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-[11px] font-semibold">
          <Footprints size={13} className="shrink-0 text-muted-foreground" aria-hidden />
          <span>{walkDrop}</span>
        </div>
      </div>

      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {guest.pickupHint} → {guest.dropHint}
      </p>

      {guest.tags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {guest.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-border bg-muted/30 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            {guest.fuelListRs !== guest.fuelOfferRs ? (
              <span className="text-[14px] font-semibold text-muted-foreground line-through">
                ₹{guest.fuelListRs}
              </span>
            ) : null}
            <span className="text-[18px] font-extrabold leading-none text-primary">
              ₹{guest.fuelOfferRs}
            </span>
            <span
              className="inline-flex items-center text-muted-foreground"
              title="Estimated fuel contribution for this stop - not a fare"
            >
              <Info size={13} aria-hidden />
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">Fuel contribution</p>
        </div>
        {!onDecline ? (
          <Button
            className={cn(
              'h-11 min-w-[7.5rem] shrink-0 rounded-xl px-4 text-[13px] font-extrabold',
              'bg-emerald-800 shadow-md shadow-emerald-900/20 hover:bg-emerald-900',
            )}
            disabled={busy}
            onClick={onOffer}
            data-testid="cleaner-city-offer-ride"
          >
            {offered
              ? live
                ? 'Accepted'
                : 'Offered'
              : offering
                ? '…'
                : acceptLabel || (live ? 'Accept' : 'Offer Ride')}
          </Button>
        ) : null}
      </div>

      {onDecline ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            className="h-11 font-extrabold bg-emerald-800 hover:bg-emerald-900"
            disabled={busy}
            onClick={onOffer}
            data-testid="cleaner-city-sticky-accept"
          >
            {offering ? '…' : acceptLabel || 'Accept'}
          </Button>
          <Button
            className="h-11 font-semibold"
            variant="outline"
            disabled={busy}
            onClick={onDecline}
            data-testid="cleaner-city-sticky-decline"
          >
            {declining ? '…' : 'Decline'}
          </Button>
        </div>
      ) : null}
    </article>
  );
}
