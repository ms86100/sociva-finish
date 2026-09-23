// @ts-nocheck
import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { getCurrentPosition, isLocationError } from '@/lib/native-location';
import { syncInstallationPermissions } from '@/lib/installation';
import { loadGoogleMapsScript } from '@/hooks/useGoogleMaps';
import { GoogleMapConfirm } from '@/components/auth/GoogleMapConfirm';
import { markLocationOnboardingDone, consumePendingBrowseReturn } from '@/lib/location-onboarding';
import { toast } from 'sonner';
import { useDiscoveryAtmosphereProducts } from '@/hooks/useDiscoveryAtmosphereProducts';
import { fetchNearbySellersPreview, type NearbyPreviewSeller } from '@/lib/discovery-nearby';
import { inviteBusinessToSociva } from '@/lib/invite-business';
import { DiscoveryMomentHero } from '@/components/location/DiscoveryMomentHero';
import { DiscoveryFindingPanel } from '@/components/location/DiscoveryFindingPanel';
import { DiscoveryEmptyPanel } from '@/components/location/DiscoveryEmptyPanel';
import { DiscoveryManualSearch } from '@/components/location/DiscoveryManualSearch';

type Step = 'explain' | 'manual' | 'confirm' | 'finding' | 'empty';

const FINDING_FLOOR_MS = 700;
const FOUND_HOLD_MS = 900;

/**
 * Sociva discovery front door - location explain + Places manual + map confirm + finding / empty.
 * Never hard-blocks the app if GPS is denied (App Store 5.1.1 + 5.1.5).
 */
export default function LocationDiscoveryPage() {
  const navigate = useNavigate();
  const { setBrowsingLocation, clearOverride } = useBrowsingLocation();
  const { data: atmosphereProducts = [] } = useDiscoveryAtmosphereProducts(true);
  const confirmingRef = useRef(false);
  const cameFromManualRef = useRef(false);
  const stepRef = useRef<Step>('explain');

  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<Step>('explain');
  const [findingPhase, setFindingPhase] = useState<'searching' | 'found'>('searching');
  const [previewSellers, setPreviewSellers] = useState<NearbyPreviewSeller[]>([]);
  const [detected, setDetected] = useState<{ lat: number; lng: number; label: string } | null>(null);

  const goToStep = useCallback((next: Step) => {
    stepRef.current = next;
    setStep(next);
  }, []);

  const reverseGeocodeLabel = async (lat: number, lng: number, fallback = 'Current location') => {
    let label = fallback;
    try {
      if (window.google?.maps) {
        const geocoder = new window.google.maps.Geocoder();
        const result = await new Promise((resolve) => {
          geocoder.geocode({ location: { lat, lng } }, (results, status) => {
            resolve(status === 'OK' && results?.[0] ? results[0] : null);
          });
        });
        if (result?.formatted_address) label = result.formatted_address;
      }
    } catch {
      // reverse geocode is best-effort
    }
    return label;
  };

  const finishWithLocation = useCallback(
    async (lat: number, lng: number, label: string, fullAddress?: string) => {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      setConfirming(true);

      try {
        setBrowsingLocation({
          id: `guest-${Date.now()}`,
          label: label || 'Near you',
          fullAddress: fullAddress || label,
          lat,
          lng,
          source: cameFromManualRef.current ? 'address' : 'gps',
        });
        markLocationOnboardingDone();
        setFindingPhase('searching');
        setPreviewSellers([]);
        goToStep('finding');
        // Ensure installation row exists (guest-safe); do not mark GPS enabled for manual picks
        void syncInstallationPermissions({});

        const started = Date.now();
        let sellers: NearbyPreviewSeller[] = [];
        try {
          sellers = await fetchNearbySellersPreview(lat, lng);
        } catch {
          sellers = [];
        }

        const elapsed = Date.now() - started;
        if (elapsed < FINDING_FLOOR_MS) {
          await new Promise((r) => setTimeout(r, FINDING_FLOOR_MS - elapsed));
        }

        if (sellers.length > 0) {
          setPreviewSellers(sellers);
          setFindingPhase('found');
          await new Promise((r) => setTimeout(r, FOUND_HOLD_MS));
          navigate(consumePendingBrowseReturn('/'), { replace: true });
          return;
        }

        goToStep('empty');
      } finally {
        confirmingRef.current = false;
        setConfirming(false);
      }
    },
    [goToStep, navigate, setBrowsingLocation],
  );

  const handleUseLocation = async () => {
    if (busy || confirmingRef.current) return;
    setBusy(true);
    try {
      await loadGoogleMapsScript();
      const pos = await getCurrentPosition({ requestPermission: true });
      const label = await reverseGeocodeLabel(pos.latitude, pos.longitude);
      if (stepRef.current !== 'manual') cameFromManualRef.current = false;
      setDetected({ lat: pos.latitude, lng: pos.longitude, label });
      goToStep('confirm');
      // Lifecycle only - independent of browsing pin / login
      void syncInstallationPermissions({ locationPermission: 'enabled' });
    } catch (err) {
      if (isLocationError(err) && err.code === 'permission_denied') {
        toast.error('Location permission denied', {
          description: 'Select your location manually instead.',
        });
        void syncInstallationPermissions({ locationPermission: 'denied' });
      } else if (isLocationError(err) && err.code === 'timeout') {
        toast.error('Location timed out', {
          description: 'Try again, or select your location manually.',
        });
      } else {
        toast.error('Could not detect location', {
          description: 'Select your location manually instead.',
        });
      }
      // Stay on explain / manual - never open Bangalore map fallback
      // Manual pin can still be set without GPS permission.
    } finally {
      setBusy(false);
    }
  };

  const handleManual = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await loadGoogleMapsScript();
    } catch {
      // Places may still fail later; search UI still opens
    }
    cameFromManualRef.current = true;
    setDetected(null);
    goToStep('manual');
    setBusy(false);
  };

  const handlePickPlace = (place: { lat: number; lng: number; label: string }) => {
    cameFromManualRef.current = true;
    setDetected({ lat: place.lat, lng: place.lng, label: place.label });
    goToStep('confirm');
  };

  const handleTryAnother = () => {
    confirmingRef.current = false;
    setConfirming(false);
    setFindingPhase('searching');
    setPreviewSellers([]);
    setDetected(null);
    goToStep('explain');
    try {
      clearOverride?.();
    } catch {
      // optional
    }
  };

  if (step === 'manual') {
    return (
      <DiscoveryManualSearch
        busy={busy}
        onBack={() => goToStep('explain')}
        onPickPlace={handlePickPlace}
        onUseLocation={() => void handleUseLocation()}
      />
    );
  }

  if (step === 'confirm' && detected) {
    return (
      <GoogleMapConfirm
        latitude={detected.lat}
        longitude={detected.lng}
        name={detected.label || 'Near you'}
        confirming={confirming}
        onConfirm={(lat, lng, updatedName, formattedAddress) => {
          void finishWithLocation(lat, lng, updatedName || detected.label, formattedAddress);
        }}
        onBack={() => goToStep(cameFromManualRef.current ? 'manual' : 'explain')}
      />
    );
  }

  if (step === 'finding') {
    return (
      <AppLayout showHeader={false} showNav={false} showCart={false}>
        <DiscoveryFindingPanel phase={findingPhase} sellers={previewSellers} />
      </AppLayout>
    );
  }

  if (step === 'empty') {
    return (
      <AppLayout showHeader={false} showNav={false} showCart={false}>
        <DiscoveryEmptyPanel
          onTryAnother={handleTryAnother}
          onSelectManual={() => void handleManual()}
          onBrowseCategories={() => navigate('/categories', { replace: true })}
          onInvite={() => void inviteBusinessToSociva()}
        />
      </AppLayout>
    );
  }

  return (
    <AppLayout showHeader={false} showNav={false} showCart={false}>
      <DiscoveryMomentHero
        products={atmosphereProducts}
        busy={busy}
        onUseLocation={() => void handleUseLocation()}
        onSelectManual={() => void handleManual()}
      />
    </AppLayout>
  );
}
