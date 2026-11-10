// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { supabase } from '@/integrations/supabase/client';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';
import {
  formatCountdown,
  locationFreshnessLabel,
  locationFreshnessTone,
} from '@/lib/cleaner-city/rideMissionCopy';

export default function CleanerCitySharePage() {
  const { token } = useParams();
  const { isLoaded } = useGoogleMaps();
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<any>(null);
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      const { data, error: err } = await supabase.rpc('cleaner_city_view_shared_ride', {
        p_token: token,
      });
      if (cancelled) return;
      if (err) {
        setError(err.message || 'Invalid or expired share link');
        setPayload(null);
        return;
      }
      setError('');
      setPayload(data);
    };
    load();
    const t = setInterval(load, 8000);
    const clock = setInterval(() => setTick((n) => n + 1), 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
      clearInterval(clock);
    };
  }, [token]);

  useEffect(() => {
    if (!isLoaded || !mapEl || !payload?.locations?.length || !window.google?.maps) return;
    const locs = payload.locations;
    const map = new google.maps.Map(mapEl, {
      center: { lat: Number(locs[0].latitude), lng: Number(locs[0].longitude) },
      zoom: 14,
      disableDefaultUI: true,
      zoomControl: true,
    });
    const markers: google.maps.Marker[] = [];
    const bounds = new google.maps.LatLngBounds();
    locs.forEach((loc: any) => {
      const pos = { lat: Number(loc.latitude), lng: Number(loc.longitude) };
      markers.push(
        new google.maps.Marker({ map, position: pos, label: loc.role === 'host' ? 'H' : 'G' }),
      );
      bounds.extend(pos);
    });
    if (locs.length > 1) map.fitBounds(bounds);
    return () => {
      markers.forEach((m) => m.setMap(null));
    };
  }, [isLoaded, mapEl, payload]);

  const freshest = useMemo(() => {
    const locs = Array.isArray(payload?.locations) ? payload.locations : [];
    if (!locs.length) return null;
    return [...locs].sort(
      (a, b) => Date.parse(b.recorded_at || 0) - Date.parse(a.recorded_at || 0),
    )[0];
  }, [payload]);

  const tone = locationFreshnessTone(freshest?.recorded_at);

  return (
    <CleanerCityChrome headerTitle="Trip share" immersive>
      <div className="p-4 space-y-3" data-testid="cleaner-city-share-page">
        {error && (
          <p className="text-sm text-destructive" data-testid="cleaner-city-share-error">
            {error}
          </p>
        )}
        {payload && (
          <>
            <p className="text-sm font-semibold">
              {payload.travel_date} · {payload.status}
            </p>
            <p
              className={
                tone === 'live'
                  ? 'text-[11px] font-semibold text-emerald-700 dark:text-emerald-300'
                  : tone === 'stale'
                    ? 'text-[11px] font-semibold text-amber-800 dark:text-amber-200'
                    : 'text-[11px] font-semibold text-muted-foreground'
              }
              data-testid="cleaner-city-share-freshness"
            >
              {locationFreshnessLabel(freshest?.recorded_at)}
            </p>
            <div ref={setMapEl} className="h-56 w-full rounded-2xl border border-border bg-muted" />
            <p className="text-[11px] text-muted-foreground" data-testid="cleaner-city-share-expiry">
              Temporary share link.
              {payload.expires_at
                ? ` ${formatCountdown(payload.expires_at) || `Expires ${String(payload.expires_at).slice(0, 19)}`}.`
                : ' Expires soon.'}{' '}
              View-only - no chat. Link stops working when revoked or expired.
            </p>
          </>
        )}
      </div>
    </CleanerCityChrome>
  );
}
