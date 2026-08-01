// @ts-nocheck
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface BrowsingLocation {
  id: string; // 'gps' | 'society' | delivery_address.id
  label: string;
  lat: number;
  lng: number;
  source: 'gps' | 'address' | 'society';
}

interface BrowsingLocationContextType {
  /** The resolved location used for marketplace discovery */
  browsingLocation: BrowsingLocation | null;
  /** Set a specific browsing location (persisted to localStorage) */
  setBrowsingLocation: (loc: BrowsingLocation | null) => void;
  /** Clear override — falls back to default address → society */
  clearOverride: () => void;
  /** Whether a user override is active */
  hasOverride: boolean;
  /** Whether a pending cart-clear confirmation is needed */
  pendingLocationChange: BrowsingLocation | null;
  confirmLocationChange: () => void;
  cancelLocationChange: () => void;
}

const BrowsingLocationContext = createContext<BrowsingLocationContextType | undefined>(undefined);

const STORAGE_KEY = 'sociva_browsing_location';
const CART_CLEAR_THRESHOLD_KM = 2;

function loadFromStorage(): BrowsingLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.lat && parsed.lng && parsed.label) return parsed;
  } catch { /* ignore */ }
  return null;
}

function loadStoredUserId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw)._user_id || null;
  } catch { return null; }
}

function saveToStorage(loc: BrowsingLocation | null, userId?: string | null) {
  try {
    if (loc) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loc, _user_id: userId || null }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

/** Simple haversine distance in km */
function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

export function BrowsingLocationProvider({ children }: { children: React.ReactNode }) {
  const { society, user } = useAuth();
  const { defaultAddress } = useDeliveryAddresses();
  const queryClient = useQueryClient();

  // Session override (highest priority)
  const [override, setOverride] = useState<BrowsingLocation | null>(() => loadFromStorage());
  const [pendingLocationChange, setPendingLocationChange] = useState<BrowsingLocation | null>(null);
  const previousLocationRef = useRef<BrowsingLocation | null>(null);

  // Bug 4 fix: Clear stale GPS override when user changes (shared device)
  useEffect(() => {
    if (!user?.id) return;
    const storedUserId = loadStoredUserId();
    if (storedUserId && storedUserId !== user.id) {
      setOverride(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [user?.id]);

  const invalidateDiscovery = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['marketplace-data'] });
    queryClient.invalidateQueries({ queryKey: ['location-stats'] });
  }, [queryClient]);

  const applyLocation = useCallback((loc: BrowsingLocation | null) => {
    setOverride(loc);
    saveToStorage(loc, user?.id);
    invalidateDiscovery();
  }, [invalidateDiscovery, user?.id]);

  const setBrowsingLocation = useCallback((loc: BrowsingLocation | null) => {
    const current = previousLocationRef.current;

    // Check if location change is significant enough to warrant cart clear warning
    if (loc && current && loc.lat && loc.lng && current.lat && current.lng) {
      const dist = distanceKm(current.lat, current.lng, loc.lat, loc.lng);
      if (dist > CART_CLEAR_THRESHOLD_KM) {
        // Check if cart has items using the correct query key shape
        const cartData = queryClient.getQueryData<any[]>(['cart-items', user?.id]);
        if (cartData && cartData.length > 0) {
          setPendingLocationChange(loc);
          return;
        }
      }
    }

    applyLocation(loc);
  }, [applyLocation, queryClient, user?.id]);

  const confirmLocationChange = useCallback(() => {
    if (!pendingLocationChange) return;
    // Clear cart via direct DB call + cache invalidation
    if (user?.id) {
      import('@/integrations/supabase/client').then(({ supabase }) => {
        supabase.from('cart_items').delete().eq('user_id', user.id).then(() => {
          queryClient.invalidateQueries({ queryKey: ['cart-items'] });
          queryClient.invalidateQueries({ queryKey: ['cart-count'] });
        });
      });
    }
    applyLocation(pendingLocationChange);
    setPendingLocationChange(null);
  }, [pendingLocationChange, applyLocation, queryClient, user?.id]);

  const cancelLocationChange = useCallback(() => {
    setPendingLocationChange(null);
  }, []);

  const clearOverride = useCallback(() => {
    applyLocation(null);
  }, [applyLocation]);

  // Fallback chain: override → default delivery address → society coordinates
  const browsingLocation = useMemo<BrowsingLocation | null>(() => {
    // 1. Session/localStorage override
    if (override) return override;

    // 2. Default delivery address (only if it has coordinates)
    if (defaultAddress?.latitude && defaultAddress?.longitude) {
      return {
        id: defaultAddress.id,
        label: defaultAddress.building_name || defaultAddress.label || 'Saved address',
        lat: defaultAddress.latitude,
        lng: defaultAddress.longitude,
        source: 'address',
      };
    }

    // 3. Society coordinates
    if (society?.latitude && society?.longitude) {
      return {
        id: 'society',
        label: society.name,
        lat: society.latitude,
        lng: society.longitude,
        source: 'society',
      };
    }

    return null;
  }, [override, defaultAddress, society]);

  // Track previous location for distance comparison
  useEffect(() => {
    if (browsingLocation) {
      previousLocationRef.current = browsingLocation;
    }
  }, [browsingLocation]);

  const hasOverride = !!override;

  return (
    <BrowsingLocationContext.Provider value={{
      browsingLocation, setBrowsingLocation, clearOverride, hasOverride,
      pendingLocationChange, confirmLocationChange, cancelLocationChange,
    }}>
      {children}

      {/* Cart clear confirmation dialog */}
      <AlertDialog open={!!pendingLocationChange} onOpenChange={(open) => { if (!open) cancelLocationChange(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch location?</AlertDialogTitle>
            <AlertDialogDescription>
              Your cart has items from your current location. Switching to "{pendingLocationChange?.label}" will clear your cart.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelLocationChange}>Stay here</AlertDialogCancel>
            <AlertDialogAction onClick={confirmLocationChange} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Switch & clear cart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BrowsingLocationContext.Provider>
  );
}

export function useBrowsingLocation(): BrowsingLocationContextType {
  const ctx = useContext(BrowsingLocationContext);
  if (!ctx) {
    // Defensive fallback: return safe no-op defaults so components
    // never crash even if rendered outside the provider tree
    // (e.g. during error recovery, Suspense fallback, or testing).
    return {
      browsingLocation: null,
      setBrowsingLocation: () => {},
      clearOverride: () => {},
      hasOverride: false,
      pendingLocationChange: null,
      confirmLocationChange: () => {},
      cancelLocationChange: () => {},
    };
  }
  return ctx;
}
