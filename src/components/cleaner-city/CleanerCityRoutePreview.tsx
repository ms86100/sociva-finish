// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { decodePolyline, type LatLng } from '@/lib/cleaner-city/routing';

type Props = {
  path?: LatLng[] | null;
  polyline?: string | null;
  className?: string;
  testId?: string;
};

/** Compact map preview of a chosen driving path (no interaction required). */
export function CleanerCityRoutePreview({ path, polyline, className, testId }: Props) {
  const { isLoaded } = useGoogleMaps();
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);

  const resolvedPath =
    path && path.length >= 2
      ? path
      : polyline
        ? decodePolyline(polyline)
        : [];

  useEffect(() => {
    if (!isLoaded || !elRef.current || !window.google?.maps) return;
    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(elRef.current, {
        center: resolvedPath[0] || { lat: 12.9716, lng: 77.5946 },
        zoom: 12,
        disableDefaultUI: true,
        gestureHandling: 'none',
        draggable: false,
        zoomControl: false,
        clickableIcons: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
    }

    lineRef.current?.setMap(null);
    lineRef.current = null;

    if (resolvedPath.length < 2) return;

    const line = new google.maps.Polyline({
      path: resolvedPath,
      geodesic: true,
      strokeColor: '#16a34a',
      strokeOpacity: 0.9,
      strokeWeight: 4,
      map: mapRef.current,
    });
    lineRef.current = line;

    const bounds = new google.maps.LatLngBounds();
    resolvedPath.forEach((p) => bounds.extend(p));
    mapRef.current.fitBounds(bounds, 36);

    return () => {
      line.setMap(null);
    };
  }, [isLoaded, polyline, resolvedPath.length, resolvedPath[0]?.lat, resolvedPath[0]?.lng, resolvedPath[resolvedPath.length - 1]?.lat]);

  if (resolvedPath.length < 2) {
    return (
      <div
        className={className || 'h-36 w-full rounded-xl border border-dashed border-border bg-muted/30'}
        data-testid={testId}
      />
    );
  }

  return (
    <div
      ref={elRef}
      className={className || 'h-40 w-full rounded-xl border border-border overflow-hidden'}
      data-testid={testId || 'cleaner-city-route-preview'}
    />
  );
}
