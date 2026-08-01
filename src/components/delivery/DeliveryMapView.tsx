// @ts-nocheck
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useGoogleMaps, clearGoogleMapsCache } from '@/hooks/useGoogleMaps';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import { Navigation, MapPin, ExternalLink, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ─── Props ───────────────────────────────────────────────────────────────────

interface DeliveryMapViewProps {
  riderLat: number;
  riderLng: number;
  destinationLat: number;
  destinationLng: number;
  riderName?: string | null;
  heading?: number | null;
  onRoadEtaChange?: (eta: number | null) => void;
  sellerLat?: number | null;
  sellerLng?: number | null;
  sellerName?: string | null;
  isPickedUp?: boolean;
  tall?: boolean;
  onRouteInfo?: (info: { totalDistance: number; remainingDistance: number }) => void;
}

// ─── Haversine distance ──────────────────────────────────────────────────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── GPS Smoothing ───────────────────────────────────────────────────────────

function useGPSSmoothing(lat: number, lng: number) {
  const history = useRef<{ lat: number; lng: number; time: number }[]>([]);

  return useMemo(() => {
    const now = Date.now();
    const h = history.current;

    if (h.length > 0) {
      const last = h[h.length - 1];
      const dist = haversineMeters(last.lat, last.lng, lat, lng);
      const timeDiff = (now - last.time) / 1000;
      if (dist > 200 && timeDiff < 2) {
        return { lat: last.lat, lng: last.lng };
      }
    }

    h.push({ lat, lng, time: now });
    if (h.length > 3) h.shift();

    if (h.length >= 3) {
      const weights = [0.15, 0.3, 0.55];
      let sLat = 0, sLng = 0;
      for (let i = 0; i < 3; i++) {
        sLat += h[i].lat * weights[i];
        sLng += h[i].lng * weights[i];
      }
      return { lat: sLat, lng: sLng };
    }
    return { lat, lng };
  }, [lat, lng]);
}

// ─── OSRM route hook ─────────────────────────────────────────────────────────

function useOSRMRoute(
  riderLat: number, riderLng: number,
  destLat: number, destLng: number,
  refetchThreshold: number,
  timeoutMs: number,
) {
  const [routeCoords, setRouteCoords] = useState<{ lat: number; lng: number }[]>([]);
  const [roadEtaMinutes, setRoadEtaMinutes] = useState<number | null>(null);
  const [roadDistanceMeters, setRoadDistanceMeters] = useState<number | null>(null);
  const [totalRouteDistance, setTotalRouteDistance] = useState<number | null>(null);
  const lastFetchPos = useRef<[number, number] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSuccessfulRoute = useRef<{ lat: number; lng: number }[]>([]);

  const fetchRoute = useCallback(async (retryCount = 0) => {
    if (lastFetchPos.current) {
      const [prevLat, prevLng] = lastFetchPos.current;
      const degThresholdLat = refetchThreshold / 111000;
      const degThresholdLng = refetchThreshold / (111000 * Math.cos(riderLat * Math.PI / 180));
      if (Math.abs(riderLat - prevLat) < degThresholdLat && Math.abs(riderLng - prevLng) < degThresholdLng) return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${riderLng},${riderLat};${destLng},${destLat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const data = await res.json();
      const route = data.routes?.[0];
      if (route?.geometry?.coordinates) {
        const coords = route.geometry.coordinates.map((c: [number, number]) => ({ lat: c[1], lng: c[0] }));
        setRouteCoords(coords);
        lastSuccessfulRoute.current = coords;
        lastFetchPos.current = [riderLat, riderLng];

        if (route.distance != null) {
          setRoadDistanceMeters(Math.round(route.distance));
          if (totalRouteDistance === null) setTotalRouteDistance(Math.round(route.distance));
        }
        if (route.duration != null) {
          let etaMin = Math.max(1, Math.ceil(route.duration / 60));
          const hour = new Date().getHours();
          const isRushHour = (hour >= 8 && hour <= 10) || (hour >= 17 && hour <= 20);
          etaMin += 2 + (isRushHour ? 3 : 0);
          setRoadEtaMinutes(etaMin);
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if ((e as Error).name === 'AbortError' && retryCount < 2) {
        setTimeout(() => fetchRoute(retryCount + 1), 1000 * (retryCount + 1) + Math.random() * 500);
      } else {
        if (lastSuccessfulRoute.current.length > 0) setRouteCoords(lastSuccessfulRoute.current);
        const fallbackDist = haversineMeters(riderLat, riderLng, destLat, destLng);
        setRoadEtaMinutes(Math.max(1, Math.ceil(fallbackDist / 1000 * 4)));
      }
    }
  }, [riderLat, riderLng, destLat, destLng, refetchThreshold, timeoutMs]);

  useEffect(() => { fetchRoute(); }, [fetchRoute]);
  useEffect(() => { return () => abortRef.current?.abort(); }, []);

  return { routeCoords, roadEtaMinutes, roadDistanceMeters, totalRouteDistance };
}

// ─── Route split (completed/remaining) ───────────────────────────────────────

function useRouteSplit(routeCoords: { lat: number; lng: number }[], riderLat: number, riderLng: number) {
  return useMemo(() => {
    if (routeCoords.length < 2) return { completed: [] as { lat: number; lng: number }[], remaining: [] as { lat: number; lng: number }[], remainingDistance: 0 };

    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = Math.pow(routeCoords[i].lat - riderLat, 2) + Math.pow(routeCoords[i].lng - riderLng, 2);
      if (d < closestDist) { closestDist = d; closestIdx = i; }
    }

    const remaining = [{ lat: riderLat, lng: riderLng }, ...routeCoords.slice(closestIdx)];
    let remainingDistance = 0;
    for (let i = 0; i < remaining.length - 1; i++) {
      remainingDistance += haversineMeters(remaining[i].lat, remaining[i].lng, remaining[i + 1].lat, remaining[i + 1].lng);
    }

    return {
      completed: routeCoords.slice(0, closestIdx + 1),
      remaining,
      remainingDistance: Math.round(remainingDistance),
    };
  }, [routeCoords, riderLat, riderLng]);
}

// ─── Branded SVG Icons ───────────────────────────────────────────────────────

function createRiderIconSvg(rotation: number = 0): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.3)"/>
      </filter>
    </defs>
    <g filter="url(#shadow)" transform="rotate(${rotation}, 28, 28)">
      <circle cx="28" cy="28" r="22" fill="#3b82f6" stroke="white" stroke-width="3"/>
      <g transform="translate(14, 12) scale(0.6)">
        <path d="M8 30c0 2.2 1.8 4 4 4s4-1.8 4-4h-8zM32 30c0 2.2 1.8 4 4 4s4-1.8 4-4h-8z" fill="white" opacity="0.9"/>
        <path d="M12 28l4-12h8l2 4h6l4-4 2 2-5 5h-6l-2-4h-4l-3 9h-6z" fill="white"/>
        <circle cx="24" cy="12" r="4" fill="white"/>
      </g>
    </g>
    <circle cx="28" cy="28" r="26" fill="none" stroke="#3b82f6" stroke-width="2" opacity="0.3">
      <animate attributeName="r" values="22;28;22" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite"/>
    </circle>
  </svg>`;
}

function createDestinationIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
    <circle cx="24" cy="24" r="20" fill="none" stroke="#ef4444" stroke-width="2" opacity="0.3">
      <animate attributeName="r" values="12;20;12" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/>
    </circle>
    <circle cx="24" cy="24" r="10" fill="#ef4444" stroke="white" stroke-width="3"/>
    <circle cx="24" cy="24" r="4" fill="white"/>
  </svg>`;
}

function createSellerIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
    <circle cx="22" cy="22" r="16" fill="#f59e0b" stroke="white" stroke-width="3"/>
    <text x="22" y="28" text-anchor="middle" font-size="16" fill="white">🏪</text>
  </svg>`;
}

// ─── Map Fallback Card ───────────────────────────────────────────────────────

function MapFallbackCard({
  riderLat, riderLng, destinationLat, destinationLng,
  riderName, roadEtaMinutes, roadDistanceMeters, tall,
  errorType, onRetry,
}: {
  riderLat: number; riderLng: number;
  destinationLat: number; destinationLng: number;
  riderName?: string | null;
  roadEtaMinutes: number | null;
  roadDistanceMeters: number | null;
  tall?: boolean;
  errorType?: string | null;
  onRetry?: () => void;
}) {
  const distText = roadDistanceMeters
    ? roadDistanceMeters < 1000 ? `${roadDistanceMeters}m` : `${(roadDistanceMeters / 1000).toFixed(1)} km`
    : null;

  const mapsUrl = `https://www.google.com/maps/dir/${riderLat},${riderLng}/${destinationLat},${destinationLng}`;
  const mapHeight = tall ? 'min-h-[200px]' : 'min-h-[160px]';

  const getErrorMessage = () => {
    if (errorType === 'AUTH_FAILED') {
      return 'Google Maps API key is restricted. Add your app domain to the key\'s allowed referrers in Google Cloud Console.';
    }
    if (errorType === 'NO_API_KEY') {
      return 'Google Maps API key not configured. Add GOOGLE_MAPS_API_KEY as a project secret.';
    }
    if (errorType === 'SCRIPT_LOAD_FAILED') {
      return 'Failed to load Google Maps. Check your internet connection.';
    }
    return riderName ? `${riderName} is on the way` : 'Your order is on the way';
  };

  return (
    <div className={`rounded-xl border border-border bg-card/80 backdrop-blur-lg p-5 ${mapHeight} flex flex-col items-center justify-center gap-3 shadow-sm`}>
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <AlertTriangle size={24} className="text-muted-foreground" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-foreground">Live map unavailable</p>
        <p className="text-xs text-muted-foreground max-w-[280px]">
          {getErrorMessage()}
        </p>
      </div>
      {(roadEtaMinutes || distText) && (
        <div className="flex items-center gap-4">
          {roadEtaMinutes && (
            <div className="text-center">
              <p className="text-lg font-bold text-primary">{roadEtaMinutes} min</p>
              <p className="text-[10px] text-muted-foreground">ETA</p>
            </div>
          )}
          {distText && (
            <div className="text-center">
              <p className="text-lg font-bold text-foreground">{distText}</p>
              <p className="text-[10px] text-muted-foreground">Distance</p>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" className="gap-2" onClick={onRetry}>
            <RefreshCw size={14} />
            Retry
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-2" asChild>
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} />
            Open in Maps
          </a>
        </Button>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function DeliveryMapView({
  riderLat, riderLng, destinationLat, destinationLng,
  riderName, heading, onRoadEtaChange,
  sellerLat, sellerLng, sellerName,
  isPickedUp, tall, onRouteInfo,
}: DeliveryMapViewProps) {
  const { isLoaded, error: mapsError, retry } = useGoogleMaps();
  const config = useTrackingConfig();
  const mapRef = useRef<google.maps.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const riderMarkerRef = useRef<google.maps.Marker | null>(null);
  const sellerMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const completedPolyRef = useRef<google.maps.Polyline | null>(null);
  const remainingPolyRef = useRef<google.maps.Polyline | null>(null);
  const remainingAnimPolyRef = useRef<google.maps.Polyline | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const animFrameRef = useRef<number>(0);
  const userPannedRef = useRef(false);
  const initialFitDone = useRef(false);
  const [showRecenter, setShowRecenter] = useState(false);
  const [mapAuthFailed, setMapAuthFailed] = useState(false);

  const smoothedPos = useGPSSmoothing(riderLat, riderLng);

  const { routeCoords, roadEtaMinutes, roadDistanceMeters, totalRouteDistance } = useOSRMRoute(
    riderLat, riderLng, destinationLat, destinationLng,
    config.osrm_refetch_threshold_meters, config.osrm_timeout_ms,
  );

  const { completed, remaining, remainingDistance } = useRouteSplit(routeCoords, smoothedPos.lat, smoothedPos.lng);

  // Notify parent of ETA
  const prevEtaRef = useRef<number | null>(null);
  useEffect(() => {
    if (roadEtaMinutes !== prevEtaRef.current) {
      prevEtaRef.current = roadEtaMinutes;
      onRoadEtaChange?.(roadEtaMinutes);
    }
  }, [roadEtaMinutes, onRoadEtaChange]);

  // Notify parent of route info
  useEffect(() => {
    if (totalRouteDistance && remainingDistance != null) {
      onRouteInfo?.({ totalDistance: totalRouteDistance, remainingDistance });
    }
  }, [totalRouteDistance, remainingDistance, onRouteInfo]);

  // Detect Google's auth failure overlay after map init
  useEffect(() => {
    if (!mapContainerRef.current || !isLoaded) return;
    
    const observer = new MutationObserver(() => {
      const container = mapContainerRef.current;
      if (!container) return;
      const errorDialog = container.querySelector('.dismissButton') || 
        Array.from(container.querySelectorAll('div')).find(el => 
          el.textContent?.includes("can't load Google Maps correctly")
        );
      if (errorDialog) {
        console.error('DeliveryMapView: Detected Google Maps auth error overlay. Origin:', window.location.origin);
        setMapAuthFailed(true);
        observer.disconnect();
      }
    });

    observer.observe(mapContainerRef.current, { childList: true, subtree: true });
    const timeout = setTimeout(() => observer.disconnect(), 10000);
    
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [isLoaded]);

  // ─── Initialize map ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLoaded || !mapContainerRef.current || mapRef.current || mapAuthFailed) return;

    const map = new google.maps.Map(mapContainerRef.current, {
      center: { lat: (riderLat + destinationLat) / 2, lng: (riderLng + destinationLng) / 2 },
      zoom: 14,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      styles: [
        { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] },
      ],
    });

    map.addListener('dragstart', () => {
      userPannedRef.current = true;
      setShowRecenter(true);
    });

    mapRef.current = map;
    infoWindowRef.current = new google.maps.InfoWindow();

    // Rider marker with branded scooter icon
    const riderIconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(createRiderIconSvg(heading || 0));
    const riderMarker = new google.maps.Marker({
      map,
      position: { lat: riderLat, lng: riderLng },
      title: riderName || 'Delivery Partner',
      icon: {
        url: riderIconUrl,
        scaledSize: new google.maps.Size(56, 56),
        anchor: new google.maps.Point(28, 28),
      },
      zIndex: 100,
    });

    riderMarker.addListener('click', () => {
      const distText = roadDistanceMeters
        ? roadDistanceMeters < 1000 ? `${roadDistanceMeters}m` : `${(roadDistanceMeters / 1000).toFixed(1)}km`
        : '';
      infoWindowRef.current?.setContent(`
        <div style="padding:8px;min-width:120px;text-align:center;">
          <p style="font-weight:700;font-size:14px;margin:0;">${riderName || 'Delivery Partner'}</p>
          ${roadEtaMinutes ? `<p style="font-size:12px;color:#666;margin:4px 0 0;">ETA: ${roadEtaMinutes} min</p>` : ''}
          ${distText ? `<p style="font-size:12px;color:#666;margin:2px 0 0;">${distText} away</p>` : ''}
        </div>
      `);
      infoWindowRef.current?.open({ map, anchor: riderMarker });
    });
    riderMarkerRef.current = riderMarker;

    // Pulsing destination marker
    const destIconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(createDestinationIconSvg());
    const destMarker = new google.maps.Marker({
      map,
      position: { lat: destinationLat, lng: destinationLng },
      title: 'Delivery Address',
      icon: {
        url: destIconUrl,
        scaledSize: new google.maps.Size(48, 48),
        anchor: new google.maps.Point(24, 24),
      },
      zIndex: 90,
    });
    destMarkerRef.current = destMarker;

    // Seller marker
    if (sellerLat && sellerLng) {
      const sellerIconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(createSellerIconSvg());
      const sellerMarker = new google.maps.Marker({
        map,
        position: { lat: sellerLat, lng: sellerLng },
        title: sellerName || 'Restaurant',
        icon: {
          url: sellerIconUrl,
          scaledSize: new google.maps.Size(44, 44),
          anchor: new google.maps.Point(22, 22),
        },
        zIndex: 80,
      });
      sellerMarkerRef.current = sellerMarker;
    }

    // Completed route (faded)
    completedPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: '#9ca3af',
      strokeWeight: 3,
      strokeOpacity: 0.4,
    });

    // Remaining route (solid base)
    remainingPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeColor: '#3b82f6',
      strokeWeight: 5,
      strokeOpacity: 0.3,
    });

    // Remaining route (animated dash overlay)
    remainingAnimPolyRef.current = new google.maps.Polyline({
      map,
      path: [],
      strokeOpacity: 0,
      icons: [{
        icon: {
          path: 'M 0,-1 0,1',
          strokeOpacity: 1,
          strokeColor: '#3b82f6',
          strokeWeight: 4,
          scale: 3,
        },
        offset: '0',
        repeat: '20px',
      }],
    });

    // Animate the dashes
    let dashOffset = 0;
    const animateDashes = () => {
      dashOffset = (dashOffset + 0.5) % 200;
      const icons = remainingAnimPolyRef.current?.get('icons');
      if (icons?.[0]) {
        icons[0].offset = dashOffset + 'px';
        remainingAnimPolyRef.current?.set('icons', icons);
      }
      requestAnimationFrame(animateDashes);
    };
    requestAnimationFrame(animateDashes);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [isLoaded, mapAuthFailed]);

  // ─── Animate rider position (smooth glide) ──────────────────────────────
  useEffect(() => {
    const marker = riderMarkerRef.current;
    if (!marker) return;

    const currentPos = marker.getPosition();
    if (!currentPos) {
      marker.setPosition(new google.maps.LatLng(smoothedPos.lat, smoothedPos.lng));
      return;
    }

    const startLat = currentPos.lat();
    const startLng = currentPos.lng();
    const endLat = smoothedPos.lat;
    const endLng = smoothedPos.lng;

    if (Math.abs(endLat - startLat) < 0.000001 && Math.abs(endLng - startLng) < 0.000001) return;

    const duration = config.map_animation_duration_ms || 1200;
    const startTime = performance.now();
    cancelAnimationFrame(animFrameRef.current);

    const animate = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
      const lat = startLat + (endLat - startLat) * ease;
      const lng = startLng + (endLng - startLng) * ease;
      marker.setPosition(new google.maps.LatLng(lat, lng));
      if (t < 1) animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animFrameRef.current);
  }, [smoothedPos.lat, smoothedPos.lng]);

  // ─── Update rider icon rotation based on heading ─────────────────────────
  useEffect(() => {
    const marker = riderMarkerRef.current;
    if (!marker || heading == null) return;
    const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(createRiderIconSvg(heading));
    marker.setIcon({
      url: iconUrl,
      scaledSize: new google.maps.Size(56, 56),
      anchor: new google.maps.Point(28, 28),
    });
  }, [heading]);

  // ─── Update polylines ────────────────────────────────────────────────────
  useEffect(() => {
    if (completed.length > 1) {
      completedPolyRef.current?.setPath(completed);
    }

    const remainPath = remaining.length > 1
      ? remaining
      : routeCoords.length > 0
        ? routeCoords
        : [
            { lat: smoothedPos.lat, lng: smoothedPos.lng },
            { lat: destinationLat, lng: destinationLng },
          ];

    remainingPolyRef.current?.setPath(remainPath);
    remainingAnimPolyRef.current?.setPath(remainPath);
  }, [completed, remaining, routeCoords, smoothedPos.lat, smoothedPos.lng, destinationLat, destinationLng]);

  // ─── Dynamic zoom + auto camera ─────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const distToDestination = haversineMeters(smoothedPos.lat, smoothedPos.lng, destinationLat, destinationLng);
    let targetZoom = 14;
    if (distToDestination > 5000) targetZoom = 12;
    else if (distToDestination > 2000) targetZoom = 14;
    else if (distToDestination > 500) targetZoom = 15;
    else targetZoom = 16;

    if (!initialFitDone.current) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: smoothedPos.lat, lng: smoothedPos.lng });
      bounds.extend({ lat: destinationLat, lng: destinationLng });
      if (sellerLat && sellerLng) bounds.extend({ lat: sellerLat, lng: sellerLng });
      map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
      initialFitDone.current = true;
    } else if (!userPannedRef.current) {
      if (isPickedUp) {
        map.panTo({ lat: smoothedPos.lat, lng: smoothedPos.lng });
        if (Math.abs(map.getZoom()! - targetZoom) > 1) {
          map.setZoom(targetZoom);
        }
      } else {
        const bounds = new google.maps.LatLngBounds();
        bounds.extend({ lat: smoothedPos.lat, lng: smoothedPos.lng });
        if (sellerLat && sellerLng) bounds.extend({ lat: sellerLat, lng: sellerLng });
        else bounds.extend({ lat: destinationLat, lng: destinationLng });
        map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
      }
    }
  }, [smoothedPos.lat, smoothedPos.lng, destinationLat, destinationLng, isPickedUp]);

  // ─── Recenter handler ────────────────────────────────────────────────────
  const handleRecenter = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    userPannedRef.current = false;
    setShowRecenter(false);
    const bounds = new google.maps.LatLngBounds();
    bounds.extend({ lat: smoothedPos.lat, lng: smoothedPos.lng });
    bounds.extend({ lat: destinationLat, lng: destinationLng });
    map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
  }, [smoothedPos.lat, smoothedPos.lng, destinationLat, destinationLng]);

  // ─── Retry handler ──────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    mapRef.current = null;
    initialFitDone.current = false;
    setMapAuthFailed(false);
    retry();
  }, [retry]);

  const mapHeight = tall ? 'h-[320px]' : 'h-[260px]';
  const distanceKm = roadDistanceMeters != null ? (roadDistanceMeters / 1000).toFixed(1) : null;

  // Show fallback for: no API key, auth failure, or detected error overlay
  const showFallback = mapsError || mapAuthFailed;

  if (showFallback) {
    return (
      <MapFallbackCard
        riderLat={riderLat}
        riderLng={riderLng}
        destinationLat={destinationLat}
        destinationLng={destinationLng}
        riderName={riderName}
        roadEtaMinutes={roadEtaMinutes}
        roadDistanceMeters={roadDistanceMeters}
        tall={tall}
        errorType={mapsError || 'AUTH_FAILED'}
        onRetry={handleRetry}
      />
    );
  }

  if (!isLoaded) {
    return (
      <div className={`rounded-xl overflow-hidden border border-border ${mapHeight} bg-muted flex items-center justify-center`}>
        <div className="text-center text-muted-foreground">
          <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-xs">Loading map...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden border border-border ${mapHeight} relative shadow-sm transition-all duration-500`}>
      <div ref={mapContainerRef} className="h-full w-full" />

      {/* ETA Overlay */}
      {roadEtaMinutes && (
        <div className="absolute bottom-2.5 right-2.5 z-10 bg-background/90 backdrop-blur-md border border-border rounded-xl px-3 py-2 shadow-md">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
              <MapPin className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-tight">
                {roadEtaMinutes > 3 ? `${roadEtaMinutes - 1}–${roadEtaMinutes + 1}` : roadEtaMinutes} min
              </p>
              {distanceKm && (
                <p className="text-[10px] text-muted-foreground leading-tight">{distanceKm} km via road</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recenter button */}
      {showRecenter && (
        <button
          onClick={handleRecenter}
          className="absolute bottom-3 left-3 z-10 bg-background/95 backdrop-blur-sm border border-border rounded-full p-2.5 shadow-lg hover:bg-accent transition-all active:scale-90"
          aria-label="Re-center map"
        >
          <Navigation className="h-4 w-4 text-primary" />
        </button>
      )}
    </div>
  );
}
