// @ts-nocheck
/**
 * Meet = guest walks to a point on the host's usual road.
 * Host does not leave the corridor to collect at the guest door.
 */
import { useEffect, useMemo, useState } from 'react';
import { Footprints, MapPin, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { Button } from '@/components/ui/button';
import { getCurrentPosition } from '@/lib/native-location';
import {
  openMapsToMeetSpot,
  type SmartMeetSpot,
} from '@/lib/cleaner-city/meetSuggest';
import { formatTripMeters } from '@/lib/cleaner-city/matchCopy';
import { cn } from '@/lib/utils';

type Pin = { lat: number; lng: number; label: string; address?: string };

type Suggestion = {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  hint?: string;
};

type Props = {
  rideId: string;
  isHost?: boolean;
  currentLabel?: string | null;
  currentLat?: number | null;
  currentLng?: number | null;
  smartSuggest?: SmartMeetSpot | null;
  guestPickupLat?: number | null;
  guestPickupLng?: number | null;
  guestPickupLabel?: string | null;
  hostOriginLat?: number | null;
  hostOriginLng?: number | null;
  hostOriginLabel?: string | null;
  savedSuggestions?: Suggestion[];
  saving?: boolean;
  onSave: (input: {
    ride_id: string;
    label: string;
    latitude: number;
    longitude: number;
  }) => Promise<unknown>;
};

function pinKey(lat: number, lng: number, label: string) {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}:${String(label || '').toLowerCase()}`;
}

function dedupeSuggestions(rows: Suggestion[]) {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const row of rows) {
    if (!Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
    const key = pinKey(row.latitude, row.longitude, row.label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function CleanerCityMeetingPointPicker({
  rideId,
  isHost = true,
  currentLabel,
  currentLat,
  currentLng,
  smartSuggest,
  guestPickupLat,
  guestPickupLng,
  guestPickupLabel,
  hostOriginLat,
  hostOriginLng,
  hostOriginLabel,
  savedSuggestions = [],
  saving,
  onSave,
}: Props) {
  const suggestedPin = useMemo((): Pin | null => {
    if (smartSuggest) {
      return {
        lat: smartSuggest.lat,
        lng: smartSuggest.lng,
        label: smartSuggest.label,
      };
    }
    if (
      guestPickupLat != null &&
      guestPickupLng != null &&
      Number.isFinite(Number(guestPickupLat))
    ) {
      return {
        lat: Number(guestPickupLat),
        lng: Number(guestPickupLng),
        label: guestPickupLabel || 'Guest on your road',
      };
    }
    return null;
  }, [smartSuggest, guestPickupLat, guestPickupLng, guestPickupLabel]);

  const initial = useMemo((): Pin | null => {
    if (
      currentLat != null &&
      currentLng != null &&
      Number.isFinite(Number(currentLat)) &&
      Number.isFinite(Number(currentLng))
    ) {
      return {
        lat: Number(currentLat),
        lng: Number(currentLng),
        label: currentLabel || 'Meet spot',
      };
    }
    return suggestedPin;
  }, [currentLat, currentLng, currentLabel, suggestedPin]);

  const [pin, setPin] = useState<Pin | null>(initial);
  const [changeSpot, setChangeSpot] = useState(false);

  useEffect(() => {
    if (initial) setPin(initial);
  }, [initial?.lat, initial?.lng, initial?.label]);

  const altChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; pin: Pin }> = [];
    for (const s of dedupeSuggestions(savedSuggestions).slice(0, 4)) {
      if (
        smartSuggest &&
        Math.abs(s.latitude - smartSuggest.lat) < 0.00025 &&
        Math.abs(s.longitude - smartSuggest.lng) < 0.00025
      ) {
        continue;
      }
      chips.push({
        id: `saved-${s.id}`,
        label: s.label,
        pin: { lat: s.latitude, lng: s.longitude, label: s.label },
      });
    }
    return chips;
  }, [savedSuggestions, smartSuggest]);

  const confirmPin = async (next: Pin) => {
    try {
      await onSave({
        ride_id: rideId,
        label: next.label || 'Meet spot',
        latitude: next.lat,
        longitude: next.lng,
      });
      setChangeSpot(false);
      toast.success(
        isHost
          ? `Guest will walk to ${next.label || 'this spot'}`
          : `Meet spot saved: ${next.label || 'Meet spot'}`,
      );
    } catch (e: any) {
      toast.error(e?.message || 'Could not set meeting point');
    }
  };

  const confirmed = !!currentLabel && currentLat != null && currentLng != null;
  const guestWalkLabel = smartSuggest
    ? formatTripMeters(smartSuggest.guestWalkMeters)
    : null;

  const openMaps = (lat: number, lng: number, label?: string | null) => {
    const { url } = openMapsToMeetSpot({
      lat,
      lng,
      label: label || undefined,
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Confirmed meet: one clear card. No map / chip clutter unless host changes it.
  if (confirmed && !changeSpot) {
    return (
      <div
        id="cleaner-city-meeting-point-section"
        className="space-y-3 rounded-2xl border border-emerald-800/15 bg-gradient-to-br from-emerald-50/90 to-white p-4 shadow-sm"
        data-testid="cleaner-city-meeting-point-section"
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-800 text-white">
            <MapPin size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-emerald-800/80">
              Meet here
            </p>
            <p
              className="mt-0.5 text-[15px] font-extrabold text-foreground"
              data-testid="cleaner-city-meeting-point-current"
            >
              {currentLabel}
            </p>
            <p className="mt-1 flex items-start gap-1.5 text-[12px] leading-snug text-muted-foreground">
              <Footprints size={13} className="mt-0.5 shrink-0 text-emerald-800" />
              {isHost
                ? 'Guest walks to this spot on your road. You stay on your usual route.'
                : "Walk to this spot on your host's road. Host does not come to your door."}
            </p>
          </div>
        </div>
        <Button
          type="button"
          className="h-11 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
          data-testid="cleaner-city-meeting-open-maps"
          onClick={() => openMaps(Number(currentLat), Number(currentLng), currentLabel)}
        >
          <Navigation size={15} className="mr-1.5" />
          {isHost ? 'Navigate to meet spot' : 'Open walk directions'}
        </Button>
        {isHost ? (
          <button
            type="button"
            className="w-full text-center text-[12px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setChangeSpot(true)}
            data-testid="cleaner-city-meeting-more-toggle"
          >
            Wrong gate? Pick another on your road
          </button>
        ) : null}
      </div>
    );
  }

  // Guest waiting: host must confirm. Guest never picks Uber-style door pin.
  if (!isHost && !confirmed) {
    return (
      <div
        id="cleaner-city-meeting-point-section"
        className="space-y-2 rounded-2xl border border-border bg-card p-4"
        data-testid="cleaner-city-meeting-point-section"
      >
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <MapPin size={14} className="text-primary" />
          Waiting for meet spot
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Host confirms a gate on their road. You walk there - they do not pick you at your
          door. That keeps their detour small.
        </p>
      </div>
    );
  }

  // Host: confirm suggestion first. Map/chips only after "Wrong gate?".
  return (
    <div
      id="cleaner-city-meeting-point-section"
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
      data-testid="cleaner-city-meeting-point-section"
    >
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <MapPin size={14} className="text-primary" />
          Where guest walks to you
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          This is not door pickup. Guest walks to a point on your usual road so you barely
          leave your corridor.
        </p>
      </div>

      {smartSuggest && !changeSpot ? (
        <div
          className="space-y-2.5 rounded-xl border border-emerald-800/20 bg-emerald-50/80 px-3 py-3"
          data-testid="cleaner-city-meeting-suggested"
          data-same-society={smartSuggest.sameSociety ? 'true' : 'false'}
          data-meet-kind={smartSuggest.kind}
        >
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-emerald-800">
              Suggested on your road
            </p>
            <p className="mt-1 text-[15px] font-extrabold text-foreground">{smartSuggest.label}</p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              {smartSuggest.sameSociety
                ? 'Same society - nearest gate for the guest.'
                : 'Different society - closest point on your corridor.'}
            </p>
            {guestWalkLabel ? (
              <p className="mt-1 text-[11px] font-semibold text-foreground/80">
                Guest walk ≈ {guestWalkLabel}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              type="button"
              className="h-11 font-extrabold bg-emerald-800 hover:bg-emerald-900"
              disabled={saving}
              data-testid="cleaner-city-meeting-use-suggested"
              onClick={() => {
                const next = {
                  lat: smartSuggest.lat,
                  lng: smartSuggest.lng,
                  label: smartSuggest.label,
                };
                setPin(next);
                void confirmPin(next);
              }}
            >
              Confirm - guest walks here
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 font-semibold"
              data-testid="cleaner-city-meeting-open-maps"
              onClick={() => openMaps(smartSuggest.lat, smartSuggest.lng, smartSuggest.label)}
            >
              Preview in Maps
            </Button>
          </div>
          <button
            type="button"
            className="w-full text-center text-[12px] font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setChangeSpot(true)}
            data-testid="cleaner-city-meeting-more-toggle"
          >
            Wrong gate? Pick another on your road
          </button>
        </div>
      ) : null}

      {!smartSuggest && !changeSpot ? (
        <Button
          type="button"
          className="h-11 w-full font-semibold"
          variant="outline"
          onClick={() => setChangeSpot(true)}
          data-testid="cleaner-city-meeting-more-toggle"
        >
          Pick a gate on your road
        </Button>
      ) : null}

      {changeSpot ? (
        <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold text-foreground">
            Pick another spot on your road only
          </p>
          <div className="flex flex-wrap gap-2" data-testid="cleaner-city-meeting-quick-chips">
            {altChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                disabled={saving}
                onClick={() => {
                  setPin(chip.pin);
                  void confirmPin(chip.pin);
                }}
                className={cn(
                  'rounded-full border border-border px-3 py-1.5 text-xs font-semibold',
                  pin &&
                    Math.abs(pin.lat - chip.pin.lat) < 0.0002 &&
                    Math.abs(pin.lng - chip.pin.lng) < 0.0002
                    ? 'border-primary bg-primary/10 text-primary'
                    : '',
                )}
                data-testid={`cleaner-city-meeting-chip-${chip.id}`}
              >
                {chip.label}
              </button>
            ))}
            {hostOriginLat != null &&
            hostOriginLng != null &&
            Number.isFinite(Number(hostOriginLat)) ? (
              <button
                type="button"
                disabled={saving}
                className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold"
                data-testid="cleaner-city-meeting-chip-host-start"
                onClick={() => {
                  const next = {
                    lat: Number(hostOriginLat),
                    lng: Number(hostOriginLng),
                    label: hostOriginLabel || 'Near your start',
                  };
                  setPin(next);
                  void confirmPin(next);
                }}
              >
                Near your start
              </button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5"
              disabled={saving}
              data-testid="cleaner-city-meeting-point-gps"
              onClick={async () => {
                try {
                  const pos = await getCurrentPosition({ requestPermission: true });
                  const next = {
                    lat: pos.latitude,
                    lng: pos.longitude,
                    label: 'My current location',
                  };
                  setPin(next);
                  await confirmPin(next);
                } catch (e: any) {
                  toast.error(e?.message || 'Could not get location');
                }
              }}
            >
              <Navigation size={13} />
              I am already at the gate
            </Button>
          </div>

          <CleanerCityPinPicker
            title="Adjust on map"
            hint="Keep the pin on your road - guest will walk to it"
            value={pin}
            onChange={setPin}
            testId="cleaner-city-meeting-map-pin"
          />

          <Button
            className="h-11 w-full font-extrabold"
            disabled={saving || !pin}
            data-testid="cleaner-city-meeting-point-confirm"
            onClick={() => {
              if (!pin) {
                toast.error('Pick a pin first');
                return;
              }
              void confirmPin(pin);
            }}
          >
            {saving ? 'Saving…' : 'Confirm - guest walks here'}
          </Button>
          <button
            type="button"
            className="w-full text-center text-[12px] font-semibold text-muted-foreground"
            onClick={() => setChangeSpot(false)}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
