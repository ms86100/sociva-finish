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
};

function statusLabel(status: DropProgressStatus): string {
  if (status === 'arrived') return 'Arrived';
  if (status === 'dropped') return 'Dropped';
  return 'Next';
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
}: Props) {
  const { ordered, progress, durationSeconds, provider } = dropOrder;
  const m = ordered.length;
  const mine = myRideId
    ? ordered.find((s) => s.id === `guest-${myRideId}`)
    : undefined;
  const canMark = isHost && ['pickup_pending', 'started'].includes(rideStatus);
  const showHostActions = isHost && rideStatus === 'started';
  const done = allGuestsDropped(ordered, progress);

  return (
    <div
      className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3"
      data-testid="cleaner-city-drop-order"
    >
      <div>
        <p className="text-sm font-semibold">Drop run</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Auto order from accepted guest pins
          {durationSeconds ? ` · ~${Math.round(durationSeconds / 60)} min` : ''}
          {provider === 'haversine_fallback' ? ' · approximate' : ''}
        </p>
        {!isHost && mine ? (
          <p
            className="text-sm font-semibold text-primary mt-2"
            data-testid="cleaner-city-guest-drop-slot"
          >
            You are Drop {mine.dropIndex} of {m}
          </p>
        ) : null}
        {isHost && m > 0 ? (
          <p className="text-xs font-semibold text-primary mt-2" data-testid="cleaner-city-host-drop-count">
            {m} guest drop{m === 1 ? '' : 's'}
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
                  isMine
                    ? 'border-primary bg-card'
                    : 'border-border bg-card/70',
                )}
              >
                <p className="text-sm font-semibold">
                  Drop {stop.dropIndex} of {m}
                  {isMine ? ' · you' : ''}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{stop.label}</p>
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
                  'rounded-xl border bg-card px-3.5 py-3 space-y-2.5',
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
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {statusLabel(status)}
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

      {isHost && ordered.length > 0 ? (
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
        <p
          className="text-xs font-semibold text-emerald-700 dark:text-emerald-300"
          data-testid="cleaner-city-drops-complete-hint"
        >
          All guests dropped - tap Complete ride when you finish.
        </p>
      ) : null}
    </div>
  );
}
