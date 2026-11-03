// @ts-nocheck
/**
 * Uber / Ola / Hopr style meetup: riders set the pin themselves.
 * No admin-seeded society list required.
 * Quick chips = GPS, guest request pin, optional saved suggestions.
 * Map = Places search + drag-to-confirm (same pin pattern as setup).
 */
import { useEffect, useMemo, useState } from 'react';
import { MapPin, Navigation } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityPinPicker } from '@/components/cleaner-city/CleanerCityPinPicker';
import { Button } from '@/components/ui/button';
import { getCurrentPosition } from '@/lib/native-location';
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
  currentLabel?: string | null;
  currentLat?: number | null;
  currentLng?: number | null;
  guestPickupLat?: number | null;
  guestPickupLng?: number | null;
  guestPickupLabel?: string | null;
  hostOriginLat?: number | null;
  hostOriginLng?: number | null;
  hostOriginLabel?: string | null;
  /** Optional ranked / society suggestions - never required */
  savedSuggestions?: Suggestion[];
  saving?: boolean;
  onSave: (input: {
    ride_id: string;
    label: string;
    latitude: number;
    longitude: number;
  }) => Promise<unknown>;
};

export function CleanerCityMeetingPointPicker({
  rideId,
  currentLabel,
  currentLat,
  currentLng,
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
        label: currentLabel || 'Meeting pin',
      };
    }
    if (
      guestPickupLat != null &&
      guestPickupLng != null &&
      Number.isFinite(Number(guestPickupLat)) &&
      Number.isFinite(Number(guestPickupLng))
    ) {
      return {
        lat: Number(guestPickupLat),
        lng: Number(guestPickupLng),
        label: guestPickupLabel || 'Guest pickup pin',
      };
    }
    if (
      hostOriginLat != null &&
      hostOriginLng != null &&
      Number.isFinite(Number(hostOriginLat)) &&
      Number.isFinite(Number(hostOriginLng))
    ) {
      return {
        lat: Number(hostOriginLat),
        lng: Number(hostOriginLng),
        label: hostOriginLabel || 'Host start',
      };
    }
    return null;
  }, [
    currentLat,
    currentLng,
    currentLabel,
    guestPickupLat,
    guestPickupLng,
    guestPickupLabel,
    hostOriginLat,
    hostOriginLng,
    hostOriginLabel,
  ]);

  const [pin, setPin] = useState<Pin | null>(initial);

  useEffect(() => {
    if (initial) setPin(initial);
  }, [initial?.lat, initial?.lng, initial?.label]);

  const quickChips = useMemo(() => {
    const chips: Array<{ id: string; label: string; pin: Pin }> = [];
    if (
      guestPickupLat != null &&
      guestPickupLng != null &&
      Number.isFinite(Number(guestPickupLat))
    ) {
      chips.push({
        id: 'guest-pickup',
        label: 'Guest pickup',
        pin: {
          lat: Number(guestPickupLat),
          lng: Number(guestPickupLng),
          label: guestPickupLabel || 'Guest pickup',
        },
      });
    }
    if (
      hostOriginLat != null &&
      hostOriginLng != null &&
      Number.isFinite(Number(hostOriginLat))
    ) {
      chips.push({
        id: 'host-start',
        label: 'Host start',
        pin: {
          lat: Number(hostOriginLat),
          lng: Number(hostOriginLng),
          label: hostOriginLabel || 'Host start',
        },
      });
    }
    for (const s of savedSuggestions.slice(0, 4)) {
      chips.push({
        id: `saved-${s.id}`,
        label: s.label,
        pin: { lat: s.latitude, lng: s.longitude, label: s.label },
      });
    }
    return chips;
  }, [
    guestPickupLat,
    guestPickupLng,
    guestPickupLabel,
    hostOriginLat,
    hostOriginLng,
    hostOriginLabel,
    savedSuggestions,
  ]);

  const confirmPin = async (next: Pin) => {
    try {
      await onSave({
        ride_id: rideId,
        label: next.label || 'Meeting pin',
        latitude: next.lat,
        longitude: next.lng,
      });
      toast.success(`Meeting pin set: ${next.label || 'Meeting pin'}`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not set meeting point');
    }
  };

  return (
    <div
      id="cleaner-city-meeting-point-section"
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
      data-testid="cleaner-city-meeting-point-section"
    >
      <div>
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <MapPin size={14} className="text-primary" />
          Meeting pin
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Like Uber and Hopr - drag the map pin or search a place. You both meet at this exact spot.
          No admin list required.
        </p>
      </div>

      {currentLabel ? (
        <p
          className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary"
          data-testid="cleaner-city-meeting-point-current"
        >
          Confirmed: {currentLabel}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" data-testid="cleaner-city-meeting-quick-chips">
        <Button
          type="button"
          size="sm"
          variant="outline"
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
          Use my GPS
        </Button>
        {quickChips.map((chip) => (
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
      </div>

      <CleanerCityPinPicker
        title="Drop the pin where you will wait"
        hint="Search a gate, lobby, or landmark - or drag the map under the blue pin"
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
            toast.error('Move the map pin first');
            return;
          }
          void confirmPin(pin);
        }}
      >
        {saving ? 'Saving pin…' : 'Confirm meeting pin'}
      </Button>
    </div>
  );
}
