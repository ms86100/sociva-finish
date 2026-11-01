// @ts-nocheck
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { supabase } from '@/integrations/supabase/client';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

export default function CleanerCitySharePage() {
  const { token } = useParams();
  const { isLoaded } = useGoogleMaps();
  const [error, setError] = useState('');
  const [payload, setPayload] = useState<any>(null);
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const load = async () => {
      const { data, error: err } = await supabase.rpc('cleaner_city_view_shared_ride', {
        p_token: token,
      });
      if (cancelled) return;
      if (err) {
        setError(err.message || 'Invalid share link');
        return;
      }
      setPayload(data);
    };
    load();
    const t = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
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

  return (
    <AppLayout headerTitle="Trip share">
      <div className="p-4 space-y-3" data-testid="cleaner-city-share-page">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {payload && (
          <>
            <p className="text-sm font-semibold">
              {payload.travel_date} · {payload.status}
            </p>
            <div ref={setMapEl} className="h-56 w-full rounded-2xl border border-border bg-muted" />
            <p className="text-[11px] text-muted-foreground">
              Temporary share link. Expires {String(payload.expires_at || '').slice(0, 19)}.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
