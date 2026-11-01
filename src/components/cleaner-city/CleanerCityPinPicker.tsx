// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAutocomplete, useGoogleMaps } from '@/hooks/useGoogleMaps';
import { getCurrentPosition } from '@/lib/native-location';
import type { LatLng } from '@/lib/cleaner-city/routing';

type Props = {
  title: string;
  hint?: string;
  value: { lat: number; lng: number; label: string; address?: string } | null;
  onChange: (next: { lat: number; lng: number; label: string; address?: string }) => void;
  testId?: string;
};

export function CleanerCityPinPicker({ title, hint, value, onChange, testId }: Props) {
  const { isLoaded, error, retry } = useGoogleMaps();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [query, setQuery] = useState(value?.label || '');
  const [busy, setBusy] = useState(false);
  const { predictions, searchPlaces, getPlaceDetails, clearPredictions } = useAutocomplete();
  const onChangeRef = useRef(onChange);
  const queryRef = useRef(query);
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
      zoom: 14,
      disableDefaultUI: true,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapInstance.current = map;
    markerRef.current = new google.maps.Marker({
      map,
      position: center,
      draggable: true,
    });

    markerRef.current.addListener('dragend', () => {
      const pos = markerRef.current?.getPosition();
      if (!pos) return;
      onChangeRef.current({
        lat: pos.lat(),
        lng: pos.lng(),
        label: queryRef.current || `${pos.lat().toFixed(5)}, ${pos.lng().toFixed(5)}`,
      });
    });

    map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;
      markerRef.current?.setPosition(e.latLng);
      onChangeRef.current({
        lat: e.latLng.lat(),
        lng: e.latLng.lng(),
        label: queryRef.current || `${e.latLng.lat().toFixed(5)}, ${e.latLng.lng().toFixed(5)}`,
      });
    });
  }, [isLoaded]);

  useEffect(() => {
    if (!mapInstance.current || !markerRef.current || !value) return;
    const pos = { lat: value.lat, lng: value.lng };
    markerRef.current.setPosition(pos);
    mapInstance.current.panTo(pos);
  }, [value?.lat, value?.lng]);

  const useGps = async () => {
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
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

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={useGps} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" size={14} /> : <MapPin size={14} />}
          <span className="ml-1">Use GPS</span>
        </Button>
        {error && (
          <Button type="button" variant="ghost" size="sm" onClick={retry}>
            Retry maps
          </Button>
        )}
      </div>

      <div
        ref={mapRef}
        className="h-48 w-full rounded-2xl border border-border bg-muted overflow-hidden"
        data-testid={testId ? `${testId}-map` : undefined}
      />

      {value && (
        <p className="text-[11px] text-muted-foreground">
          Pinned {value.lat.toFixed(5)}, {value.lng.toFixed(5)}
          {value.label ? ` - ${value.label}` : ''}
        </p>
      )}
    </div>
  );
}
