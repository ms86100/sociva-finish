import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { CleanerCityRideCard, CommutePublication } from '@/hooks/queries/useCleanerCity';
import { guestDropRankFromOrder } from '@/lib/cleaner-city/dropRun';
import { firstName, rideStatusLabel } from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

type VehicleLike = {
  id: string;
  vehicle_type?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  registration_number?: string | null;
  seat_capacity?: number | null;
};

type Props = {
  publication: CommutePublication;
  vehicle?: VehicleLike | null;
  guests: CleanerCityRideCard[];
  todayIso: string;
  focused?: boolean;
  onCancel?: () => void;
  cancelPending?: boolean;
};

function dayLabel(date: string, today: string) {
  if (date === today) return 'Today';
  const t = new Date(`${today}T12:00:00`);
  t.setDate(t.getDate() + 1);
  const tomorrow = t.toISOString().slice(0, 10);
  if (date === tomorrow) return 'Tomorrow';
  return date;
}

function directionLabel(direction?: string | null) {
  if (direction === 'to_home') return 'To home';
  if (direction === 'to_office') return 'To office';
  return String(direction || 'Commute').replace('_', ' ');
}

function hostGuestStatus(status?: string | null) {
  if (status === 'requested') return 'Waiting for your Accept';
  return rideStatusLabel(status);
}

function pinLine(kind: 'pickup' | 'drop', lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) return `${kind === 'pickup' ? 'Pickup' : 'Drop'} point not set`;
  return `${kind === 'pickup' ? 'Pickup' : 'Drop'} point set`;
}

function statusTone(status?: string | null) {
  const s = String(status || '');
  if (s === 'published') return 'text-emerald-700 dark:text-emerald-300';
  if (s === 'full') return 'text-amber-700 dark:text-amber-300';
  if (s === 'cancelled') return 'text-muted-foreground';
  if (s === 'completed') return 'text-muted-foreground';
  return 'text-primary';
}

function statusHeadline(status?: string | null) {
  const s = String(status || 'draft');
  if (s === 'published') return 'Seats open';
  if (s === 'full') return 'All seats taken';
  if (s === 'draft') return 'Not published yet';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'completed') return 'Finished';
  return s.replace(/_/g, ' ');
}

export function HostOfferRideCard({
  publication: p,
  vehicle,
  guests,
  todayIso,
  focused,
  onCancel,
  cancelPending,
}: Props) {
  const live = p.status === 'published' || p.status === 'full';
  const cancelled = p.status === 'cancelled';
  const vehicleLabel = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ') ||
      vehicle.vehicle_type ||
      'Vehicle'
    : null;
  const seatsOpen = Number(p.seats_available || 0);
  const seatsTotal = Number(p.seats_total || 0);
  const pending = guests.filter((g) => g.status === 'requested');
  const onboard = guests.filter((g) =>
    ['confirmed', 'pickup_pending', 'started'].includes(g.status),
  );
  const when = `${dayLabel(p.travel_date, todayIso)} · leave ${String(p.depart_time || '').slice(0, 5) || '-'}`;
  const where = `${p.origin_label || 'Home'} → ${p.destination_label || 'Office'}`;

  if (cancelled) {
    return (
      <article
        className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3"
        data-testid="cleaner-city-host-offer-card"
        data-status="cancelled"
      >
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
          Cancelled
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground/80">
          {when} · {directionLabel(p.direction)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Neighbours can no longer request this leave time.
        </p>
      </article>
    );
  }

  return (
    <article
      className={cn(
        'rounded-2xl border bg-card p-4 space-y-3.5',
        focused ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border',
      )}
      data-testid="cleaner-city-host-offer-card"
      data-focused={focused ? 'true' : undefined}
      data-status={p.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={cn(
              'text-[11px] font-extrabold uppercase tracking-[0.14em]',
              statusTone(p.status),
            )}
          >
            {statusHeadline(p.status)}
          </p>
          <p className="mt-1 text-base font-extrabold text-foreground">{when}</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground/90">
            {directionLabel(p.direction)}
          </p>
        </div>
        {onCancel && ['draft', 'published', 'full'].includes(p.status) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={cancelPending}
            onClick={onCancel}
          >
            Cancel offer
          </Button>
        ) : null}
      </div>

      <dl className="grid gap-2 rounded-xl border border-border/80 bg-muted/20 px-3.5 py-3 text-xs">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">Route</dt>
          <dd className="min-w-0 break-words text-muted-foreground">{where}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">Seats</dt>
          <dd className="min-w-0 text-muted-foreground">
            {live
              ? `${seatsOpen} of ${seatsTotal} still open`
              : `${seatsOpen} of ${seatsTotal} open`}
            {vehicleLabel ? ` · ${vehicleLabel}` : ''}
            {vehicle?.registration_number ? ` · ${vehicle.registration_number}` : ''}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">Guests</dt>
          <dd className="min-w-0 text-muted-foreground">
            {guests.length === 0
              ? 'Waiting for neighbours to request a seat'
              : pending.length > 0
                ? `${pending.length} request${pending.length === 1 ? '' : 's'} need Accept`
                : `${onboard.length} guest${onboard.length === 1 ? '' : 's'} booked`}
          </dd>
        </div>
      </dl>

      {guests.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {p.status === 'published'
            ? 'Your empty seats are visible on Find. Tap Find Guests on Home to see neighbours on this road.'
            : p.status === 'full'
              ? 'All seats on this leave time are taken.'
              : 'Publish this leave time so neighbours can request a seat.'}
        </p>
      ) : (
        <div className="space-y-2" data-testid="cleaner-city-host-offer-riders">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            Guests
          </p>
          {guests.map((g) => {
            const rank = guestDropRankFromOrder(p.drop_order_json, g.id);
            const name = g.guest_name || 'Neighbour';
            return (
              <Link
                key={g.id}
                to={`/cleaner-city/ride/${g.id}`}
                className="block rounded-xl border border-border bg-background/60 px-3.5 py-3 transition-colors active:bg-muted/40"
                data-testid="cleaner-city-host-offer-rider"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-foreground truncate">
                      {name}
                      {g.guest_flat ? ` · Flat ${g.guest_flat}` : ''}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold text-primary">
                      {hostGuestStatus(g.status)}
                      {rank ? ` · Drop ${rank.n} of ${rank.m}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-extrabold text-primary">
                    Open
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                  <li>
                    Meet:{' '}
                    {g.meeting_point_label ||
                      (g.meeting_point_latitude != null
                        ? 'Pin set'
                        : 'Meeting point not set yet')}
                  </li>
                  <li>
                    {pinLine(
                      'pickup',
                      g.guest_pickup_latitude,
                      g.guest_pickup_longitude,
                    )}
                  </li>
                  <li>
                    {pinLine('drop', g.guest_dest_latitude, g.guest_dest_longitude)}
                  </li>
                  {g.status === 'requested' ? (
                    <li className="font-semibold text-amber-700 dark:text-amber-300">
                      Tap to Accept or decline
                    </li>
                  ) : (
                    <li>Tap for messages, OTP, and the trip map</li>
                  )}
                </ul>
              </Link>
            );
          })}
        </div>
      )}

      {pending.length > 0 ? (
        <Button asChild className="h-11 w-full font-semibold">
          <Link
            to="/cleaner-city"
            state={{
              openHosting: true,
              notice: `${pending.length} seat request${pending.length === 1 ? '' : 's'} waiting - Accept or decline.`,
            }}
          >
            Review {pending.length} seat request{pending.length === 1 ? '' : 's'}
          </Link>
        </Button>
      ) : onboard.length > 0 ? (
        <Button asChild variant="outline" className="h-11 w-full font-semibold">
          <Link to={`/cleaner-city/ride/${onboard[0].id}`}>
            Open trip with {firstName(onboard[0].guest_name) || 'guest'}
          </Link>
        </Button>
      ) : p.status === 'published' ? (
        <Button asChild variant="outline" className="h-11 w-full font-semibold">
          <Link
            to="/cleaner-city"
            state={{
              openFindGuests: true,
              travelDate: p.travel_date,
              direction: p.direction,
              departTime: p.depart_time,
              notice:
                'Browse guests on this road. Accept live requests, or Offer Ride to neighbours nearby.',
            }}
          >
            Find Guests on Home
          </Link>
        </Button>
      ) : p.status === 'full' ? (
        <Button asChild variant="outline" className="h-11 w-full font-semibold">
          <Link to="/cleaner-city">Back to Home</Link>
        </Button>
      ) : null}
    </article>
  );
}
