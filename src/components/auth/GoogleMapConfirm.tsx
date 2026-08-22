// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { MapPin, Check, Loader2, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
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
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const mapInitializedRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const resolveRequestIdRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);

  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat: latitude, lng: longitude });
  const [displayName, setDisplayName] = useState(name);
  const [formattedAddress, setFormattedAddress] = useState('');
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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

      if (map) {
        const placesLabel = await findNearbyPlaceName(map, lat, lng);
        if (placesLabel) {
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

  const commitCenter = useCallback((lat: number, lng: number, options?: { preserveInitial?: boolean; panMap?: boolean }) => {
    setCenter({ lat, lng });
    if (options?.panMap && mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat, lng });
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

    mapInstanceRef.current = map;
    geocoderRef.current = new google.maps.Geocoder();
    mapInitializedRef.current = true;

    const mapDragStartListener = map.addListener('dragstart', () => {
      hasUserInteractedRef.current = true;
      setIsDragging(true);
    });

    const mapDragEndListener = map.addListener('dragend', () => {
      setIsDragging(false);
    });

    const idleListener = map.addListener('idle', () => {
      const next = map.getCenter();
      if (!next) return;
      const lat = next.lat();
      const lng = next.lng();
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        commitCenter(lat, lng, { preserveInitial: !hasUserInteractedRef.current });
      }, 180);
    });

    const zoomListener = map.addListener('zoom_changed', () => {
      hasUserInteractedRef.current = true;
    });

    const mapClickListener = map.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (!event.latLng) return;
      hasUserInteractedRef.current = true;
      map.panTo(event.latLng);
    });

    resolveLabel(latitude, longitude, true);

    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
      mapDragStartListener.remove();
      mapDragEndListener.remove();
      idleListener.remove();
      zoomListener.remove();
      mapClickListener.remove();
      mapInstanceRef.current = null;
      geocoderRef.current = null;
      mapInitializedRef.current = false;
    };
  }, [latitude, longitude, resolveLabel, commitCenter]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapInitializedRef.current) return;
    if (hasUserInteractedRef.current) return;
    mapInstanceRef.current.panTo({ lat: latitude, lng: longitude });
  }, [latitude, longitude]);

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

        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center">
          <div className={cn('relative flex flex-col items-center transition-transform duration-150', isDragging ? '-translate-y-3 scale-110' : '-translate-y-2')}>
            <div className="w-5 h-5 rounded-full bg-[#1a73e8] border-[3px] border-white shadow-[0_2px_8px_rgba(26,115,232,0.45)]" />
            <div className="w-px h-3 bg-[#1a73e8]/80" />
            <div className={cn('w-2 h-2 rounded-full bg-black/25 blur-[1px]', isDragging ? 'opacity-40' : 'opacity-70')} />
          </div>
        </div>

        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
          <div className="bg-background/90 backdrop-blur-sm text-xs text-muted-foreground px-3 py-1.5 rounded-full shadow-sm border border-border">
            Move the map to position the location
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
            onClick={() => onConfirm(center.lat, center.lng, displayNameRef.current, formattedAddressRef.current)}
            disabled={isGeocoding || isDragging}
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
