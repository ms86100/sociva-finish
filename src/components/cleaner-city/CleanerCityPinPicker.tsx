// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState } from 'react';
import { LocateFixed, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAutocomplete, useGoogleMaps } from '@/hooks/useGoogleMaps';
import { getCurrentPosition } from '@/lib/native-location';
import { cn } from '@/lib/utils';
import type { LatLng } from '@/lib/cleaner-city/routing';

type Props = {
  title: string;
  hint?: string;
  value: { lat: number; lng: number; label: string; address?: string } | null;
  onChange: (next: { lat: number; lng: number; label: string; address?: string }) => void;
  testId?: string;
};

/**
 * Same blue center pin pattern as Sociva address confirm (GoogleMapConfirm):
 * the map moves under a fixed blue circle. No red teardrop marker.
 */
export function CleanerCityPinPicker({ title, hint, value, onChange, testId }: Props) {
  const { isLoaded, error, retry } = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const idleTimer = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const queryRef = useRef('');
  const userMovedRef = useRef(false);
  const [query, setQuery] = useState(value?.label || '');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const { predictions, searchPlaces, getPlaceDetails, clearPredictions } = useAutocomplete();
  onChangeRef.current = onChange;
  queryRef.current = query;

  useEffect(() => {
    if (value?.label) setQuery(value.label);
  }, [value?.label]);

  useEffect(() => {
    if (!isLoaded || !mapRef.current || mapInstance.current) return;
    const center: LatLng = value
      ? { lat: value.lat, lng: value.lng }
      : { lat: 12.9716, lng: 77.5946 };
    const map = new google.maps.Map(mapRef.current, {
      center,
      zoom: 16,
      disableDefaultUI: true,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      gestureHandling: 'greedy',
    });
    mapInstance.current = map;

    map.addListener('dragstart', () => {
      userMovedRef.current = true;
      setDragging(true);
    });
    map.addListener('dragend', () => setDragging(false));
    map.addListener('idle', () => {
      if (!userMovedRef.current) return;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        const c = map.getCenter();
        if (!c) return;
        onChangeRef.current({
          lat: c.lat(),
          lng: c.lng(),
          label: queryRef.current || `${c.lat().toFixed(5)}, ${c.lng().toFixed(5)}`,
        });
      }, 180);
    });
  }, [isLoaded]);

  useEffect(() => {
    if (!mapInstance.current || !value) return;
    if (userMovedRef.current) {
      userMovedRef.current = false;
      return;
    }
    mapInstance.current.panTo({ lat: value.lat, lng: value.lng });
  }, [value?.lat, value?.lng]);

  const useGps = async () => {
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      userMovedRef.current = false;
      onChange({
        lat: pos.latitude,
        lng: pos.longitude,
        label: query || 'Current location',
      });
    } catch {
      // parent toasts
    } finally {
      setBusy(false);
    }
  };

  const pickPrediction = async (placeId: string, description: string) => {
    const details = await getPlaceDetails(placeId);
    clearPredictions();
    if (!details) return;
    setQuery(description);
    userMovedRef.current = false;
    onChange({
      lat: details.latitude,
      lng: details.longitude,
      label: details.name || description,
      address: details.formattedAddress || description,
    });
  };

  return (
    <div className="space-y-3" data-testid={testId}>
      <div>
        <Label className="text-sm font-semibold">{title}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>

      <div className="relative">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (isLoaded) searchPlaces(e.target.value);
          }}
          placeholder="Search place or address"
          data-testid={testId ? `${testId}-search` : undefined}
        />
        {predictions?.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-card shadow-lg max-h-48 overflow-auto">
            {predictions.slice(0, 6).map((p) => (
              <button
                key={p.placeId}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                onClick={() => pickPrediction(p.placeId, p.description)}
              >
                {p.description}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border bg-muted">
        <div
          ref={mapRef}
          className="h-52 w-full"
          data-testid={testId ? `${testId}-map` : undefined}
        />
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            className={cn(
              'relative flex flex-col items-center transition-transform duration-150',
              dragging ? '-translate-y-3 scale-110' : '-translate-y-2',
            )}
          >
            <div className="h-5 w-5 rounded-full border-[3px] border-white bg-[#1a73e8] shadow-[0_2px_8px_rgba(26,115,232,0.45)]" />
            <div className="h-3 w-px bg-[#1a73e8]/80" />
            <div className={cn('h-2 w-2 rounded-full bg-black/25 blur-[1px]', dragging ? 'opacity-40' : 'opacity-70')} />
          </div>
        </div>
        <button
          type="button"
          onClick={useGps}
          disabled={busy}
          className="absolute bottom-3 right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-border/80 bg-background/95 text-primary shadow-md backdrop-blur-md active:scale-95"
          aria-label="Use GPS"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={20} />}
        </button>
        <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
          Move the map to place the blue pin
        </p>
      </div>

      <div className="flex gap-2">
        {error && (
          <Button type="button" variant="ghost" size="sm" onClick={retry}>
            Retry maps
          </Button>
        )}
      </div>

      {value && (
        <p className="text-xs text-muted-foreground" data-testid={testId ? `${testId}-label` : undefined}>
          {value.label || value.address || 'Pinned on map'}
        </p>
      )}
    </div>
  );
}
