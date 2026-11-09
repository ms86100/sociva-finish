// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useEffect, useRef } from 'react';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import { decodePolyline, type LatLng, type RouteAlternative } from '@/lib/cleaner-city/routing';
import { cn } from '@/lib/utils';

type Props = {
  path?: LatLng[] | null;
  polyline?: string | null;
  alternatives?: RouteAlternative[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
  testId?: string;
};

type LineBundle = {
  id: string;
  hit: google.maps.Polyline;
  outline: google.maps.Polyline;
  dots: google.maps.Polyline;
  listeners: google.maps.MapsEventListener[];
};

/** Distinct colours per suggested road - selected stays vivid, others stay readable. */
export const ROUTE_COLORS = [
  { ink: '#059669', soft: '#6ee7b7', label: 'Green' },
  { ink: '#2563eb', soft: '#93c5fd', label: 'Blue' },
  { ink: '#ea580c', soft: '#fdba74', label: 'Orange' },
  { ink: '#7c3aed', soft: '#c4b5fd', label: 'Purple' },
];

function resolvePath(alt: { path?: LatLng[]; polyline?: string }): LatLng[] {
  if (alt.path && alt.path.length >= 2) return alt.path;
  if (alt.polyline) return decodePolyline(alt.polyline);
  return [];
}

function midPoint(path: LatLng[]): LatLng {
  const i = Math.floor(path.length / 2);
  return path[i] || path[0];
}

/** Map of suggested roads: coloured moving dots, tap a path to choose. */
export function CleanerCityRoutePreview({
  path,
  polyline,
  alternatives,
  selectedId,
  onSelect,
  className,
  testId,
}: Props) {
  const { isLoaded } = useGoogleMaps();
  const elRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const linesRef = useRef<LineBundle[]>([]);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const labelMarkersRef = useRef<google.maps.Marker[]>([]);
  const animRef = useRef<number | null>(null);
  const offsetRef = useRef(0);

  const routes: Array<{ id: string; path: LatLng[]; summary?: string }> =
    alternatives && alternatives.length
      ? alternatives.map((a) => ({
          id: a.id,
          path: resolvePath(a),
          summary: a.summary,
        }))
      : path && path.length >= 2
        ? [{ id: 'single', path }]
        : polyline
          ? [{ id: 'single', path: decodePolyline(polyline) }]
          : [];

  const selectable = typeof onSelect === 'function' && routes.length > 0;

  useEffect(() => {
    if (!isLoaded || !elRef.current || !window.google?.maps) return;

    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(elRef.current, {
        center: routes[0]?.path?.[0] || { lat: 12.9716, lng: 77.5946 },
        zoom: 12,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        zoomControl: true,
        clickableIcons: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: [
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'road', elementType: 'geometry', stylers: [{ lightness: 18 }] },
        ],
      });
    }

    if (animRef.current != null) {
      window.clearInterval(animRef.current);
      animRef.current = null;
    }
    linesRef.current.forEach((bundle) => {
      bundle.listeners.forEach((l) => l.remove());
      bundle.hit.setMap(null);
      bundle.outline.setMap(null);
      bundle.dots.setMap(null);
    });
    linesRef.current = [];
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];
    labelMarkersRef.current.forEach((m) => m.setMap(null));
    labelMarkersRef.current = [];

    const valid = routes.filter((r) => r.path.length >= 2);
    if (!valid.length) return;

    const bounds = new google.maps.LatLngBounds();
    const activeId = selectedId || valid[0].id;

    // Draw unselected first, selected last (on top).
    const ordered = [
      ...valid.filter((r) => r.id !== activeId),
      ...valid.filter((r) => r.id === activeId),
    ];

    ordered.forEach((route) => {
      const index = valid.findIndex((r) => r.id === route.id);
      const colors = ROUTE_COLORS[index % ROUTE_COLORS.length];
      const selected = route.id === activeId;
      const ink = colors.ink;

      route.path.forEach((p) => bounds.extend(p));

      // Soft road underlay (follows the real path) so the corridor is obvious.
      // Keep it light so the moving dashes stay the main cue (Zomato-style).
      const hit = new google.maps.Polyline({
        path: route.path,
        geodesic: true,
        strokeColor: ink,
        strokeOpacity: selected ? 0.18 : 0.12,
        strokeWeight: selected ? 10 : 7,
        zIndex: selected ? 30 : 10 + index,
        map: mapRef.current,
        clickable: selectable,
      });

      // White dashed halo for contrast on map tiles.
      const outline = new google.maps.Polyline({
        path: route.path,
        geodesic: true,
        strokeOpacity: 0,
        zIndex: selected ? 31 : 11 + index,
        map: mapRef.current,
        clickable: false,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              scale: selected ? 4 : 3,
              strokeColor: '#ffffff',
              strokeOpacity: selected ? 0.95 : 0.75,
              strokeWeight: selected ? 3 : 2,
            },
            offset: '0',
            repeat: '10px',
          },
        ],
      });

      // Coloured dashed motion on top (Zomato-style marching dashes).
      const dots = new google.maps.Polyline({
        path: route.path,
        geodesic: true,
        strokeOpacity: 0,
        zIndex: selected ? 32 : 12 + index,
        map: mapRef.current,
        clickable: selectable,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              scale: selected ? 3.6 : 2.8,
              strokeColor: ink,
              strokeOpacity: selected ? 1 : 0.85,
              strokeWeight: selected ? 3.2 : 2.4,
            },
            offset: '0',
            repeat: '10px',
          },
        ],
      });

      const listeners: google.maps.MapsEventListener[] = [];
      if (selectable) {
        const pick = () => onSelect?.(route.id);
        listeners.push(hit.addListener('click', pick));
        listeners.push(dots.addListener('click', pick));
      }

      linesRef.current.push({ id: route.id, hit, outline, dots, listeners });

      // Number badge mid-route so each colour maps to a card.
      labelMarkersRef.current.push(
        new google.maps.Marker({
          position: midPoint(route.path),
          map: mapRef.current,
          zIndex: selected ? 50 : 35 + index,
          clickable: selectable,
          title: route.summary || `Road ${index + 1}`,
          label: {
            text: String(index + 1),
            color: '#ffffff',
            fontWeight: '700',
            fontSize: '11px',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: selected ? 11 : 9,
            fillColor: ink,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        }),
      );
      if (selectable) {
        const last = labelMarkersRef.current[labelMarkersRef.current.length - 1];
        listeners.push(
          last.addListener('click', () => onSelect?.(route.id)),
        );
      }
    });

    const active = valid.find((r) => r.id === activeId) || valid[0];
    const activeColor =
      ROUTE_COLORS[valid.findIndex((r) => r.id === active.id) % ROUTE_COLORS.length].ink;
    markersRef.current = [
      new google.maps.Marker({
        position: active.path[0],
        map: mapRef.current,
        title: 'Start',
        zIndex: 60,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: activeColor,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
        },
      }),
      new google.maps.Marker({
        position: active.path[active.path.length - 1],
        map: mapRef.current,
        title: 'End',
        zIndex: 60,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#111827',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2.5,
        },
      }),
    ];

    mapRef.current.fitBounds(bounds, 56);

    animRef.current = window.setInterval(() => {
      offsetRef.current = (offsetRef.current + 1) % 400;
      linesRef.current.forEach((bundle) => {
        const selected = bundle.id === activeId;
        const step = selected ? 2 : 1;
        const off = `${(offsetRef.current * step) % 18}px`;
        for (const poly of [bundle.outline, bundle.dots]) {
          const icons = poly.get('icons');
          if (!icons?.[0]) continue;
          icons[0].offset = off;
          poly.set('icons', icons);
        }
      });
    }, 32);

    return () => {
      if (animRef.current != null) {
        window.clearInterval(animRef.current);
        animRef.current = null;
      }
      linesRef.current.forEach((bundle) => {
        bundle.listeners.forEach((l) => l.remove());
        bundle.hit.setMap(null);
        bundle.outline.setMap(null);
        bundle.dots.setMap(null);
      });
      linesRef.current = [];
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      labelMarkersRef.current.forEach((m) => m.setMap(null));
      labelMarkersRef.current = [];
    };
  }, [
    isLoaded,
    selectedId,
    selectable,
    alternatives?.map((a) => a.id).join('|'),
    alternatives?.map((a) => a.polyline).join('|'),
    path?.[0]?.lat,
    path?.[path.length - 1]?.lat,
    polyline,
  ]);

  if (routes.every((r) => r.path.length < 2)) {
    return (
      <div
        className={cn(
          'h-48 w-full rounded-xl border border-dashed border-border bg-muted/30',
          className,
        )}
        data-testid={testId}
      />
    );
  }

  return (
    <div className={cn('space-y-1.5', className)}>
      <div
        ref={elRef}
        className="h-64 w-full rounded-xl border border-border overflow-hidden shadow-sm"
        data-testid={testId || 'cleaner-city-route-preview'}
      />
      {routes.length > 1 ? (
        <p className="text-[11px] text-muted-foreground px-0.5">
          {routes.length} Google roads shown in different colours. Tap a dotted path or its number to choose.
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground px-0.5">
          Your suggested road is the moving dotted path on the map.
        </p>
      )}
    </div>
  );
}
