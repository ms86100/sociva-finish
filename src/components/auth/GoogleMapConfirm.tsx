// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { MapPin, Check, Loader2, ArrowLeft } from 'lucide-react';
import {
  extractBestLabel,
  extractBestFormattedAddress,
  findNearbyPlaceName,
  pickBetterLabel,
  formatCoords,
  LabelQuality,
  type ResolvedLabel,
} from '@/lib/location-label-resolver';

interface GoogleMapConfirmProps {
  latitude: number;
  longitude: number;
  name: string;
  onConfirm: (lat: number, lng: number, updatedName?: string, formattedAddress?: string) => void;
  onBack: () => void;
}

function callerNameToLabel(name: string): ResolvedLabel | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const genericPlaceholders = ['store location', 'your location', 'location pinned'];
  if (genericPlaceholders.includes(trimmed.toLowerCase())) return null;
  return { name: trimmed, quality: LabelQuality.POI };
}

export function GoogleMapConfirm({ latitude, longitude, name, onConfirm, onBack }: GoogleMapConfirmProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const mapInitializedRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const resolveRequestIdRef = useRef(0);

  const [marker, setMarker] = useState<{ lat: number; lng: number }>({ lat: latitude, lng: longitude });
  const [displayName, setDisplayName] = useState(name);
  const [formattedAddress, setFormattedAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);

  const displayNameRef = useRef(name);
  const formattedAddressRef = useRef('');
  const initialLabelRef = useRef<ResolvedLabel | null>(callerNameToLabel(name));

  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);

  useEffect(() => {
    formattedAddressRef.current = formattedAddress;
  }, [formattedAddress]);

  useEffect(() => {
    initialLabelRef.current = callerNameToLabel(name);
    if (name.trim()) setDisplayName(name);
  }, [name]);

  const resolveLabel = useCallback(async (lat: number, lng: number, preserveInitial: boolean) => {
    const requestId = ++resolveRequestIdRef.current;
    setIsGeocoding(true);

    let currentBest: ResolvedLabel | null = preserveInitial ? initialLabelRef.current : null;
    let bestAddress: string | null = null;

    try {
      const geocoder = geocoderRef.current;
      const map = mapInstanceRef.current;
      if (!geocoder) return;

      const geocodeResult = await new Promise<google.maps.GeocoderResult[] | null>((resolve) => {
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          resolve(status === 'OK' && results ? results : null);
        });
      });

      if (geocodeResult) {
        bestAddress = extractBestFormattedAddress(geocodeResult);
        const geocodeLabel = extractBestLabel(geocodeResult);
        currentBest = pickBetterLabel(currentBest, geocodeLabel);
      }

      // Always consult Places API — it has fresher, more accurate POI names
      // than the Geocoder (which may return a nearby landmark/circle instead
      // of the actual business under the pin, e.g. "Mountain High Studio Cafe").
      if (map) {
        const placesLabel = await findNearbyPlaceName(map, lat, lng);
        if (placesLabel) {
          // If the initial caller-supplied label matches a real POI nearby, keep it.
          // Otherwise prefer the Places result over geocoder POIs that are often
          // street/area names rather than the business itself.
          if (preserveInitial && currentBest && currentBest.quality === LabelQuality.POI) {
            // keep caller label
          } else {
            currentBest = placesLabel;
          }
        } else {
          currentBest = pickBetterLabel(currentBest, null);
        }
      }
    } catch (err) {
      console.warn('[GoogleMapConfirm] Label resolution error:', err);
    }

    if (requestId !== resolveRequestIdRef.current) return;

    if (!currentBest) currentBest = formatCoords(lat, lng);

    setDisplayName(currentBest.name);
    const finalAddress = bestAddress || currentBest.formattedAddress || '';
    setFormattedAddress(finalAddress);
    setIsGeocoding(false);
  }, []);

  const updateMarkerPosition = useCallback((lat: number, lng: number, options?: { preserveInitial?: boolean; panMap?: boolean }) => {
    const nextPos = { lat, lng };
    setMarker(nextPos);

    if (markerRef.current) {
      markerRef.current.setPosition(nextPos);
    }

    if (options?.panMap && mapInstanceRef.current) {
      mapInstanceRef.current.panTo(nextPos);
    }

    resolveLabel(lat, lng, options?.preserveInitial ?? false);
  }, [resolveLabel]);

  useEffect(() => {
    if (!mapRef.current || !(window as any).google?.maps) {
      console.warn('GoogleMapConfirm: Google Maps not loaded');
      return;
    }
    if (mapInitializedRef.current) return;

    const initialPos = { lat: latitude, lng: longitude };

    const map = new google.maps.Map(mapRef.current, {
      center: initialPos,
      zoom: 17,
      maxZoom: 21,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
      styles: [{ featureType: 'poi', stylers: [{ visibility: 'simplified' }] }],
    });

    const markerInstance = new google.maps.Marker({
      map,
      position: initialPos,
      draggable: true,
      title: 'Selected location',
      cursor: 'grab',
    });

    mapInstanceRef.current = map;
    markerRef.current = markerInstance;
    geocoderRef.current = new google.maps.Geocoder();
    mapInitializedRef.current = true;

    const mapDragStartListener = map.addListener('dragstart', () => {
      hasUserInteractedRef.current = true;
    });

    const mapDragEndListener = map.addListener('dragend', () => {
      const center = map.getCenter();
      if (!center) return;
      updateMarkerPosition(center.lat(), center.lng());
    });

    const zoomListener = map.addListener('zoom_changed', () => {
      hasUserInteractedRef.current = true;
    });

    const mapClickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      hasUserInteractedRef.current = true;
      updateMarkerPosition(event.latLng.lat(), event.latLng.lng());
    });

    const markerDragStartListener = markerInstance.addListener('dragstart', () => {
      hasUserInteractedRef.current = true;
      map.setOptions({ draggable: false });
    });

    const markerDragEndListener = markerInstance.addListener('dragend', () => {
      map.setOptions({ draggable: true });
      const pos = markerInstance.getPosition();
      if (!pos) return;
      updateMarkerPosition(pos.lat(), pos.lng());
    });

    resolveLabel(latitude, longitude, true);

    return () => {
      mapDragStartListener.remove();
      mapDragEndListener.remove();
      zoomListener.remove();
      mapClickListener.remove();
      markerDragStartListener.remove();
      markerDragEndListener.remove();
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      mapInstanceRef.current = null;
      geocoderRef.current = null;
      mapInitializedRef.current = false;
    };
  }, [latitude, longitude, resolveLabel, updateMarkerPosition]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapInitializedRef.current) return;
    updateMarkerPosition(latitude, longitude, {
      preserveInitial: true,
      panMap: !hasUserInteractedRef.current,
    });
  }, [latitude, longitude, updateMarkerPosition]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background flex flex-col" style={{ overscrollBehavior: 'contain' }}>
      <div className="shrink-0 flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top,0px),12px)] pb-3 bg-background/95 backdrop-blur-sm z-10">
        <button
          onClick={onBack}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="text-base font-semibold text-foreground">Confirm Location</h2>
      </div>

      <div className="flex-1 relative" style={{ touchAction: 'none' }}>
        <div ref={mapRef} className="absolute inset-0" />

        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-background/90 backdrop-blur-sm text-xs text-muted-foreground px-3 py-1.5 rounded-full shadow-sm border border-border">
            Drag the pin or tap the map
          </div>
        </div>
      </div>

      <div className="shrink-0 bg-background border-t border-border px-4 pt-3 pb-[max(env(safe-area-inset-bottom,0px),16px)] space-y-3">
        <div className="flex items-start gap-2.5">
          <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{displayName}</p>
            {formattedAddress && formattedAddress !== displayName && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{formattedAddress}</p>
            )}
          </div>
          {isGeocoding && <Loader2 size={14} className="animate-spin text-muted-foreground shrink-0 mt-0.5" />}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" onClick={onBack} className="flex-1 h-12 rounded-xl">
            Back
          </Button>
          <Button
            onClick={() => onConfirm(marker.lat, marker.lng, displayNameRef.current, formattedAddressRef.current)}
            disabled={isGeocoding}
            className="flex-1 h-12 rounded-xl font-semibold"
          >
            {isGeocoding ? (
              <Loader2 size={16} className="mr-1 animate-spin" />
            ) : (
              <Check size={16} className="mr-1" />
            )}
            {isGeocoding ? 'Locating…' : 'Confirm Location'}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
