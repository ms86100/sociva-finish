import { Button } from '@/components/ui/button';
import {
  allGuestsDropped,
  stopProgressStatus,
  type DropOrderPersisted,
  type DropProgressStatus,
} from '@/lib/cleaner-city/dropRun';
import { openGoogleMapsDirections, type LatLng } from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';
import { Check, MapPinned, Navigation } from 'lucide-react';

type Props = {
  dropOrder: DropOrderPersisted;
  isHost: boolean;
  myRideId?: string | null;
  rideStatus: string;
  missionOrigin: LatLng;
  hostFinalDest: LatLng;
  currentGps?: LatLng | null;
  onMarkStop: (stopId: string, status: DropProgressStatus) => void;
  markingStopId?: string | null;
  onCompleteRide?: () => void;
  completing?: boolean;
};

function statusLabel(status: DropProgressStatus, single: boolean): string {
  if (status === 'arrived') return single ? 'At their drop' : 'Arrived';
  if (status === 'dropped') return single ? 'Dropped off' : 'Dropped';
  return single ? 'On the way to drop' : 'Next';
}

function etaLine(durationSeconds?: number | null, approximate?: boolean) {
  const eta = durationSeconds ? `~${Math.round(durationSeconds / 60)} min` : null;
  if (!eta && !approximate) return null;
  return [eta, approximate ? 'approx' : null].filter(Boolean).join(' · ');
}

export function DropRunPanel({
  dropOrder,
  isHost,
  myRideId,
  rideStatus,
  missionOrigin,
  hostFinalDest,
  currentGps,
  onMarkStop,
  markingStopId,
  onCompleteRide,
  completing,
}: Props) {
  const { ordered, progress, durationSeconds, provider } = dropOrder;
  const m = ordered.length;
  const single = m === 1;
  const mine = myRideId
    ? ordered.find((s) => s.id === `guest-${myRideId}`)
    : undefined;
  const canMark = isHost && ['pickup_pending', 'started'].includes(rideStatus);
  const showHostActions = isHost && rideStatus === 'started';
  const done = allGuestsDropped(ordered, progress);
  const approx = provider === 'haversine_fallback';
  const eta = etaLine(durationSeconds, approx);

  // One guest: no "Drop order / Drop 1 / 1 guest drop" theater.
  if (single) {
    const stop = ordered[0];
    const status = stopProgressStatus(progress, stop.id);
    const busy = markingStopId === stop.id;
    const origin = currentGps || missionOrigin;
    const dest = { lat: stop.lat, lng: stop.lng };

    return (
      <div
        className="space-y-3 rounded-2xl border border-emerald-800/15 bg-emerald-50/70 p-4"
        data-testid="cleaner-city-drop-order"
        data-drop-mode="single"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-emerald-800/80">
              {isHost ? 'Dropping guest' : 'Your drop'}
            </p>
            <p className="mt-0.5 truncate text-[15px] font-extrabold text-foreground">
              {stop.label}
            </p>
            {eta ? <p className="mt-0.5 text-xs text-muted-foreground">{eta}</p> : null}
            {!isHost ? (
              <p
                className="mt-1 text-sm font-semibold text-primary"
                data-testid="cleaner-city-guest-drop-slot"
              >
                You are the only drop on this ride
              </p>
            ) : (
              <p
                className="mt-1 text-xs font-semibold text-muted-foreground"
                data-testid="cleaner-city-host-drop-count"
              >
                {statusLabel(status, true)}
              </p>
            )}
          </div>
          {status === 'dropped' ? (
            <Check size={18} className="shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <MapPinned size={18} className="shrink-0 text-emerald-800" aria-hidden />
          )}
        </div>

        {isHost && (canMark || showHostActions) ? (
          <div className="flex flex-col gap-2" data-testid="cleaner-city-drop-stop-1">
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full font-semibold"
              data-testid="cleaner-city-open-maps-drop-1"
              onClick={() =>
                openGoogleMapsDirections({
                  origin,
                  destination: dest,
                })
              }
            >
              <Navigation size={14} className="mr-1.5" aria-hidden />
              Navigate to drop
            </Button>
            {showHostActions && status === 'pending' ? (
              <Button
                type="button"
                className="h-11 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
                disabled={busy}
                data-testid="cleaner-city-mark-arrived-1"
                onClick={() => onMarkStop(stop.id, 'arrived')}
              >
                Arrived at drop
              </Button>
            ) : null}
            {showHostActions && status === 'arrived' ? (
              <Button
                type="button"
                className="h-11 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
                disabled={busy}
                data-testid="cleaner-city-mark-dropped-1"
                onClick={() => onMarkStop(stop.id, 'dropped')}
              >
                Guest is off
              </Button>
            ) : null}
          </div>
        ) : null}

        {isHost && rideStatus === 'started' && done ? (
          <div className="space-y-2" data-testid="cleaner-city-drops-complete-hint">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              Guest is off. Close the ride when you are done.
            </p>
            {onCompleteRide ? (
              <Button
                type="button"
                className="h-11 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
                disabled={completing}
                onClick={onCompleteRide}
                data-testid="cleaner-city-complete-ride"
              >
                Complete ride
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="space-y-3 rounded-2xl border border-primary/30 bg-primary/5 p-4"
      data-testid="cleaner-city-drop-order"
      data-drop-mode="multi"
    >
      <div>
        <p className="text-sm font-semibold">Drop order</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {eta || 'Guests in drop order'}
        </p>
        {!isHost && mine ? (
          <p
            className="mt-2 text-sm font-semibold text-primary"
            data-testid="cleaner-city-guest-drop-slot"
          >
            You are Drop {mine.dropIndex} of {m}
          </p>
        ) : null}
        {isHost ? (
          <p className="mt-2 text-xs font-semibold text-primary" data-testid="cleaner-city-host-drop-count">
            {m} guest drops
            {done ? ' · all dropped' : ''}
          </p>
        ) : null}
      </div>

      {!isHost && ordered.length > 0 ? (
        <ol className="space-y-2" data-testid="cleaner-city-guest-drop-list">
          {ordered.map((stop) => {
            const isMine = myRideId ? stop.id === `guest-${myRideId}` : false;
            return (
              <li
                key={stop.id}
                className={cn(
                  'rounded-xl border px-3.5 py-3',
                  isMine ? 'border-primary bg-card' : 'border-border bg-card/70',
                )}
              >
                <p className="text-sm font-semibold">
                  Drop {stop.dropIndex} of {m}
                  {isMine ? ' · you' : ''}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{stop.label}</p>
              </li>
            );
          })}
        </ol>
      ) : null}

      {isHost
        ? ordered.map((stop, index) => {
            const status = stopProgressStatus(progress, stop.id);
            const origin =
              currentGps ||
              (index === 0
                ? missionOrigin
                : {
                    lat: ordered[index - 1].lat,
                    lng: ordered[index - 1].lng,
                  });
            const dest = { lat: stop.lat, lng: stop.lng };
            const busy = markingStopId === stop.id;
            return (
              <div
                key={stop.id}
                className={cn(
                  'space-y-2.5 rounded-xl border bg-card px-3.5 py-3',
                  status === 'dropped'
                    ? 'border-emerald-500/40'
                    : status === 'arrived'
                      ? 'border-amber-500/40'
                      : 'border-border',
                )}
                data-testid={`cleaner-city-drop-stop-${stop.dropIndex}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      Drop {stop.dropIndex} · {stop.label}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {statusLabel(status, false)}
                    </p>
                  </div>
                  {status === 'dropped' ? (
                    <Check size={16} className="shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <MapPinned size={16} className="shrink-0 text-primary" aria-hidden />
                  )}
                </div>

                {canMark || showHostActions ? (
                  <div className="flex flex-col gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 w-full font-semibold"
                      data-testid={`cleaner-city-open-maps-drop-${stop.dropIndex}`}
                      onClick={() =>
                        openGoogleMapsDirections({
                          origin,
                          destination: dest,
                        })
                      }
                    >
                      <Navigation size={14} className="mr-1.5" aria-hidden />
                      Open this stop in Maps
                    </Button>
                    {showHostActions && status === 'pending' ? (
                      <Button
                        type="button"
                        className="h-10 w-full font-semibold"
                        disabled={busy}
                        data-testid={`cleaner-city-mark-arrived-${stop.dropIndex}`}
                        onClick={() => onMarkStop(stop.id, 'arrived')}
                      >
                        Arrived
                      </Button>
                    ) : null}
                    {showHostActions && status === 'arrived' ? (
                      <Button
                        type="button"
                        className="h-10 w-full font-semibold"
                        disabled={busy}
                        data-testid={`cleaner-city-mark-dropped-${stop.dropIndex}`}
                        onClick={() => onMarkStop(stop.id, 'dropped')}
                      >
                        Dropped
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        : null}

      {isHost && ordered.length > 1 ? (
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full font-semibold"
          data-testid="cleaner-city-open-maps-drops"
          onClick={() =>
            openGoogleMapsDirections({
              origin: currentGps || missionOrigin,
              destination: hostFinalDest,
              waypoints: ordered.map((s) => ({ lat: s.lat, lng: s.lng })),
            })
          }
        >
          Open full drop run in Maps
        </Button>
      ) : null}

      {isHost && rideStatus === 'started' && done ? (
        <div className="space-y-2" data-testid="cleaner-city-drops-complete-hint">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            All guests dropped. Close the ride when you are done.
          </p>
          {onCompleteRide ? (
            <Button
              type="button"
              className="h-11 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
              disabled={completing}
              onClick={onCompleteRide}
              data-testid="cleaner-city-complete-ride"
            >
              Complete ride
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
