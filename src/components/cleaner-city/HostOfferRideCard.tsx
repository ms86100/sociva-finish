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
  if (direction === 'to_home') return 'Homebound';
  if (direction === 'to_office') return 'To office';
  return String(direction || 'Commute').replace('_', ' ');
}

function hostGuestStatus(status?: string | null) {
  if (status === 'requested') return 'Waiting for your Accept';
  return rideStatusLabel(status);
}

function pinLine(kind: 'pickup' | 'drop', lat?: number | null, lng?: number | null) {
  if (lat == null || lng == null) return `${kind === 'pickup' ? 'Pickup' : 'Drop'} pin not set`;
  return `${kind === 'pickup' ? 'Pickup' : 'Drop'} pin · ${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
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
  const vehicleLabel = vehicle
    ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ') ||
      vehicle.vehicle_type ||
      'Vehicle'
    : null;
  const seatsTaken = Math.max(0, Number(p.seats_total || 0) - Number(p.seats_available || 0));
  const pending = guests.filter((g) => g.status === 'requested');
  const onboard = guests.filter((g) =>
    ['confirmed', 'pickup_pending', 'started'].includes(g.status),
  );
  const when = `${dayLabel(p.travel_date, todayIso)} · leave ${String(p.depart_time || '').slice(0, 5) || '-'}`;
  const where = `${p.origin_label || 'Pickup'} → ${p.destination_label || 'Office'}`;

  return (
    <article
      className={cn(
        'rounded-2xl border bg-card p-4 space-y-3.5',
        focused ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border',
      )}
      data-testid="cleaner-city-host-offer-card"
      data-focused={focused ? 'true' : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-primary">
            Your offer · {String(p.status || 'draft')}
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
            Cancel
          </Button>
        ) : null}
      </div>

      <dl className="grid gap-2 rounded-xl border border-border/80 bg-muted/20 px-3.5 py-3 text-xs">
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">When</dt>
          <dd className="min-w-0 text-muted-foreground">{when}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">Where</dt>
          <dd className="min-w-0 break-words text-muted-foreground">{where}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">What</dt>
          <dd className="min-w-0 text-muted-foreground">
            {seatsTaken}/{p.seats_total} seats taken · {p.seats_available} open
            {vehicleLabel ? ` · ${vehicleLabel}` : ''}
            {vehicle?.registration_number ? ` · ${vehicle.registration_number}` : ''}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-14 shrink-0 font-semibold text-foreground/80">Who</dt>
          <dd className="min-w-0 text-muted-foreground">
            {guests.length === 0
              ? 'No riders yet - neighbours request from Find'
              : `${onboard.length} riding · ${pending.length} waiting for Accept`}
          </dd>
        </div>
      </dl>

      {guests.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Empty seats are live. When someone asks, Accept appears on Find. After you accept, their
          name, flat, and pins show here.
        </p>
      ) : (
        <div className="space-y-2" data-testid="cleaner-city-host-offer-riders">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            Riders on this offer
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
                      Action: open ride and Accept, or open Find hosting
                    </li>
                  ) : (
                    <li>Tap to message, OTP, map, and drop run</li>
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
            to="/cleaner-city/find"
            state={{
              openHosting: true,
              notice: `${pending.length} seat request${pending.length === 1 ? '' : 's'} waiting - Accept or decline.`,
            }}
          >
            Accept {pending.length} request{pending.length === 1 ? '' : 's'} on Find
          </Link>
        </Button>
      ) : onboard.length > 0 ? (
        <Button asChild variant="outline" className="h-11 w-full font-semibold">
          <Link to={`/cleaner-city/ride/${onboard[0].id}`}>
            Open mission with {firstName(onboard[0].guest_name) || 'guest'}
          </Link>
        </Button>
      ) : (
        <Button asChild variant="outline" className="h-11 w-full font-semibold">
          <Link
            to="/cleaner-city/find"
            state={{
              openHosting: true,
              notice: 'Hosting is live. Seat requests show here when neighbours ask.',
            }}
          >
            Watch for seat requests
          </Link>
        </Button>
      )}
    </article>
  );
}
