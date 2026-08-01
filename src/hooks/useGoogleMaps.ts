// @ts-nocheck
/// <reference types="@types/google.maps" />
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

const SCRIPT_ID = 'google-maps-script';

// ─── Global auth failure tracking ────────────────────────────────────────────
let gmAuthFailed = false;
const authFailureListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  (window as any).gm_authFailure = () => {
    console.error(
      'useGoogleMaps: Google Maps authentication failure (invalid/restricted API key).\n' +
      `Current origin: ${window.location.origin}\n` +
      'Fix: Go to Google Cloud Console → APIs & Services → Credentials → your API key → HTTP referrers.\n' +
      `Add: ${window.location.origin}/*`
    );
    gmAuthFailed = true;
    authFailureListeners.forEach(fn => fn());
  };
}

// ─── In-memory API key cache ─────────────────────────────────────────────────
let cachedApiKey: string | null = null;
let keyFetchPromise: Promise<string | null> | null = null;

/** Clear the cached key so the next load re-fetches from the edge function */
export function clearGoogleMapsCache() {
  cachedApiKey = null;
  keyFetchPromise = null;
  gmAuthFailed = false;
  // Remove existing script so it can be re-injected
  const script = document.getElementById(SCRIPT_ID);
  if (script) {
    script.remove();
    delete (window as any).google;
  }
}

async function fetchGoogleMapsApiKey(): Promise<string | null> {
  if (cachedApiKey) return cachedApiKey;
  if (keyFetchPromise) return keyFetchPromise;

  keyFetchPromise = (async () => {
    // 1. Try Edge Function (reads secret + admin_settings server-side)
    try {
      const { data, error } = await supabase.functions.invoke('get-google-maps-key');
      if (!error && data?.apiKey) {
        console.info(`useGoogleMaps: API key loaded via edge function (source: ${data.source || 'unknown'})`);
        cachedApiKey = data.apiKey;
        return cachedApiKey;
      }
      if (error) console.warn('useGoogleMaps: Edge function error:', error);
    } catch (e) {
      console.warn('useGoogleMaps: Edge function fetch failed:', e);
    }

    // 2. Fallback: direct admin_settings query (works if RLS allows it)
    try {
      const { data } = await supabase
        .from('admin_settings')
        .select('value, is_active')
        .eq('key', 'google_maps_api_key')
        .maybeSingle();
      if (data?.value && data.is_active !== false) {
        console.info('useGoogleMaps: API key loaded from admin_settings fallback');
        cachedApiKey = data.value;
        return cachedApiKey;
      }
    } catch (e) {
      console.warn('useGoogleMaps: admin_settings fallback failed:', e);
    }

    console.warn('useGoogleMaps: No valid API key found');
    return null;
  })();

  const result = await keyFetchPromise;
  keyFetchPromise = null;
  return result;
}

// ─── Script loader ───────────────────────────────────────────────────────────
export async function loadGoogleMapsScript(): Promise<void> {
  const apiKey = await fetchGoogleMapsApiKey();

  if (!apiKey) {
    throw new Error('NO_API_KEY');
  }

  // Reset auth failure when loading with a (possibly new) key
  gmAuthFailed = false;

  const existingScript = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (existingScript) {
    const existingSrc = existingScript.getAttribute('src') || '';
    if (existingSrc.includes(apiKey) && (window as any).google?.maps) {
      if (gmAuthFailed) throw new Error('AUTH_FAILED');
      return;
    }
    existingScript.remove();
    delete (window as any).google;
  } else if ((window as any).google?.maps) {
    if (gmAuthFailed) throw new Error('AUTH_FAILED');
    return;
  }

  console.info(`useGoogleMaps: Loading script for origin ${window.location.origin}`);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      setTimeout(() => {
        if (gmAuthFailed) {
          reject(new Error('AUTH_FAILED'));
        } else {
          resolve();
        }
      }, 500);
    };
    script.onerror = () => reject(new Error('SCRIPT_LOAD_FAILED'));
    document.head.appendChild(script);
  });
}

// ─── Hook ────────────────────────────────────────────────────────────────────
export function useGoogleMaps() {
  const [isLoaded, setIsLoaded] = useState(!!(window as any).google?.maps && !gmAuthFailed);
  const [error, setError] = useState<string | null>(gmAuthFailed ? 'AUTH_FAILED' : null);

  const retry = useCallback(() => {
    clearGoogleMapsCache();
    setError(null);
    setIsLoaded(false);
  }, []);

  useEffect(() => {
    if (isLoaded) return;
    if (error && error !== 'RETRYING') return;

    loadGoogleMapsScript()
      .then(() => { setIsLoaded(true); setError(null); })
      .catch((err) => setError(err.message));

    const listener = () => {
      setError('AUTH_FAILED');
      setIsLoaded(false);
    };
    authFailureListeners.add(listener);
    return () => { authFailureListeners.delete(listener); };
  }, [isLoaded, error]);

  return { isLoaded, error, retry };
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlaceDetails {
  name: string;
  formattedAddress: string;
  city: string;
  state: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

// ─── Autocomplete hook ───────────────────────────────────────────────────────
export function useAutocomplete() {
  const { isLoaded, error } = useGoogleMaps();
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const searchPlaces = useCallback(async (input: string) => {
    if (!isLoaded || !input.trim() || input.length < 3) {
      setPredictions([]);
      return;
    }
    setIsSearching(true);
    try {
      const { suggestions } = await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        includedRegionCodes: ['in'],
      });

      setPredictions(
        suggestions
          .filter((s): s is google.maps.places.AutocompleteSuggestion & { placePrediction: google.maps.places.PlacePrediction } => !!s.placePrediction)
          .map((s) => ({
            placeId: s.placePrediction.placeId,
            description: s.placePrediction.text.toString(),
            mainText: s.placePrediction.mainText?.toString() || s.placePrediction.text.toString(),
            secondaryText: s.placePrediction.secondaryText?.toString() || '',
          }))
      );
    } catch (err) {
      console.error('AutocompleteSuggestion error:', err);
      setPredictions([]);
    } finally {
      setIsSearching(false);
    }
  }, [isLoaded]);

  const getPlaceDetails = useCallback(async (placeId: string): Promise<PlaceDetails | null> => {
    if (!isLoaded) return null;
    try {
      const { Place } = await google.maps.importLibrary('places') as google.maps.PlacesLibrary;
      const place = new Place({ id: placeId });
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'addressComponents', 'location'] });

      const components = place.addressComponents || [];
      const get = (type: string) => components.find((c) => c.types.includes(type))?.longText || '';

      return {
        name: place.displayName || '',
        formattedAddress: place.formattedAddress || '',
        city: get('locality') || get('administrative_area_level_2'),
        state: get('administrative_area_level_1'),
        pincode: get('postal_code'),
        latitude: place.location?.lat() || 0,
        longitude: place.location?.lng() || 0,
      };
    } catch (err) {
      console.error('Place fetchFields error:', err);
      return null;
    }
  }, [isLoaded]);

  const clearPredictions = useCallback(() => setPredictions([]), []);

  return { predictions, isSearching, searchPlaces, getPlaceDetails, clearPredictions, isLoaded, error };
}
