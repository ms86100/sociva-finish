// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Capacitor } from '@capacitor/core';

interface ArrivalState {
  isNearHome: boolean;
  distanceMeters: number | null;
}

interface SocietyGeo {
  lat: number;
  lng: number;
  radius: number;
}

export function useArrivalDetection(): ArrivalState {
  const { user, profile } = useAuth();
  const [state, setState] = useState<ArrivalState>({ isNearHome: false, distanceMeters: null });
  const [society, setSociety] = useState<SocietyGeo | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const getDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }, []);

  // Fetch society geo data
  useEffect(() => {
    if (!user || !profile?.society_id) return;

    (async () => {
      const { data } = await supabase
        .from('societies')
        .select('latitude, longitude, geofence_radius_meters')
        .eq('id', profile.society_id!)
        .single();

      if (data?.latitude && data?.longitude) {
        setSociety({
          lat: data.latitude,
          lng: data.longitude,
          radius: data.geofence_radius_meters || 500,
        });
      }
    })();
  }, [user, profile?.society_id]);

  // Start geolocation watch when society data is available
  useEffect(() => {
    if (!society) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const checkPosition = (pos: GeolocationPosition) => {
      if (!society) return;

      const dist = getDistance(pos.coords.latitude, pos.coords.longitude, society.lat, society.lng);
      const isNear = dist <= society.radius;

      setState(prev => {
        if (prev.isNearHome !== isNear || Math.abs((prev.distanceMeters ?? 0) - dist) > 50) {
          return { isNearHome: isNear, distanceMeters: Math.round(dist) };
        }
        return prev;
      });
    };

    if (Capacitor.isNativePlatform()) {
      (async () => {
        const { Geolocation } = await import('@capacitor/geolocation');
        const id = await Geolocation.watchPosition({ enableHighAccuracy: false }, (pos) => {
          if (pos) checkPosition(pos as unknown as GeolocationPosition);
        });
        watchIdRef.current = parseInt(id, 10);
      })();
    } else {
      // Check permission before starting watch on web
      if (navigator.permissions) {
        navigator.permissions.query({ name: 'geolocation' }).then(result => {
          if (result.state === 'granted') {
            watchIdRef.current = navigator.geolocation.watchPosition(
              checkPosition,
              () => {},
              { enableHighAccuracy: false, maximumAge: 60000, timeout: 10000 }
            );
          }
        }).catch(() => {});
      }
    }

    return () => {
      if (watchIdRef.current != null) {
        if (Capacitor.isNativePlatform()) {
          import('@capacitor/geolocation').then(({ Geolocation }) => {
            Geolocation.clearWatch({ id: String(watchIdRef.current) });
          });
        } else {
          navigator.geolocation.clearWatch(watchIdRef.current);
        }
        watchIdRef.current = null;
      }
    };
  }, [getDistance, society]);

  return state;
}
