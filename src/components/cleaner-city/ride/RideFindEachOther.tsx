// @ts-nocheck
import { Crosshair, Navigation, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { locationFreshnessLabel } from '@/lib/cleaner-city/rideMissionCopy';
import { cn } from '@/lib/utils';

type PartnerPin = {
  latitude: number;
  longitude: number;
  recorded_at?: string | null;
} | null;

type Props = {
  sharing?: boolean;
  partnerPin?: PartnerPin;
  onShareMine: () => void;
  className?: string;
};

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

/**
 * On-demand pin ping when host and guest cannot see each other at the meet spot.
 * No embedded map - opens external Maps for the partner pin.
 */
export function RideFindEachOther({ sharing, partnerPin, onShareMine, className }: Props) {
  const partnerFresh = partnerPin
    ? locationFreshnessLabel(partnerPin.recorded_at)
    : null;

  return (
    <div
      className={cn(
        'space-y-3 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4',
        className,
      )}
      data-testid="cleaner-city-find-each-other"
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-600/15 text-amber-800">
          <Crosshair size={15} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-foreground">Can&apos;t find each other?</p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            Send your live pin once. Partner opens it in Maps - no live map billing on this page.
          </p>
        </div>
      </div>

      <Button
        type="button"
        className="h-11 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
        disabled={sharing}
        onClick={onShareMine}
        data-testid="cleaner-city-share-live-pin"
      >
        <MapPin size={15} className="mr-1.5" />
        {sharing ? 'Sending pin…' : 'Share my live pin'}
      </Button>

      {partnerPin ? (
        <div
          className="space-y-2 rounded-xl border border-border bg-card/80 px-3 py-2.5"
          data-testid="cleaner-city-partner-live-pin"
        >
          <p className="text-[12px] text-muted-foreground">
            Partner pin
            {partnerFresh ? (
              <span className="font-semibold text-foreground"> · {partnerFresh}</span>
            ) : null}
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-10 w-full font-semibold"
            data-testid="cleaner-city-open-partner-pin"
            onClick={() =>
              window.open(
                mapsUrl(Number(partnerPin.latitude), Number(partnerPin.longitude)),
                '_blank',
                'noopener,noreferrer',
              )
            }
          >
            <Navigation size={14} className="mr-1.5" />
            Open partner pin in Maps
          </Button>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Waiting for partner to share their pin.
        </p>
      )}
    </div>
  );
}
