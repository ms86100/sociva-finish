// @ts-nocheck
import { useState, useRef, useCallback } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { MapPin, Home, Briefcase, Tag, Building, Navigation, Loader2, Plus, Check } from 'lucide-react';
import { useDeliveryAddresses } from '@/hooks/useDeliveryAddresses';
import { useAuth } from '@/contexts/AuthContext';
import { useBrowsingLocation } from '@/contexts/BrowsingLocationContext';
import { getCurrentPosition } from '@/lib/native-location';
import { loadGoogleMapsScript } from '@/hooks/useGoogleMaps';
import { GoogleMapConfirm } from '@/components/auth/GoogleMapConfirm';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface LocationSelectorSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LABEL_ICONS: Record<string, typeof Home> = {
  Home, Work: Briefcase, Other: Tag,
};

export function LocationSelectorSheet({ open, onOpenChange }: LocationSelectorSheetProps) {
  const { addresses } = useDeliveryAddresses();
  const { society } = useAuth();
  const { browsingLocation, setBrowsingLocation, clearOverride } = useBrowsingLocation();
  const navigate = useNavigate();
  const [detectingGps, setDetectingGps] = useState(false);
  const [step, setStep] = useState<'pick' | 'confirm'>('pick');
  const [detectedLocation, setDetectedLocation] = useState<{ lat: number; lng: number; label: string } | null>(null);

  const handleSelectAddress = (addr: any) => {
    if (!addr.latitude || !addr.longitude) {
      toast.error('This address has no location coordinates');
      return;
    }
    setBrowsingLocation({
      id: addr.id,
      label: addr.building_name || addr.label || 'Saved address',
      lat: addr.latitude,
      lng: addr.longitude,
      source: 'address',
    });
    onOpenChange(false);
  };

  const handleUseSociety = () => {
    clearOverride();
    onOpenChange(false);
  };

  const handleUseGps = async () => {
    setDetectingGps(true);
    try {
      const pos = await getCurrentPosition();

      try {
        await loadGoogleMapsScript();
      } catch { /* proceed with fallback */ }

      let label = '';
      const nearbyAddr = addresses.find(a =>
        a.latitude && a.longitude &&
        Math.abs(a.latitude - pos.latitude) < 0.005 &&
        Math.abs(a.longitude - pos.longitude) < 0.005
      );
      label = nearbyAddr?.building_name || nearbyAddr?.label || '';

      setDetectedLocation({ lat: pos.latitude, lng: pos.longitude, label });
      setStep('confirm');
    } catch {
      toast.error('Could not detect location. Please enable location access.');
    } finally {
      setDetectingGps(false);
    }
  };

  const handleConfirmGps = useCallback((lat: number, lng: number, updatedName?: string) => {
    setBrowsingLocation({
      id: 'gps',
      label: updatedName || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      lat,
      lng,
      source: 'gps',
    });
    onOpenChange(false);
    toast.success(`Browsing near ${updatedName || 'detected location'}`);
  }, [setBrowsingLocation, onOpenChange]);

  const handleBackFromConfirm = useCallback(() => {
    setStep('pick');
    setDetectedLocation(null);
  }, []);

  const handleAddAddress = () => {
    onOpenChange(false);
    navigate('/profile/edit');
  };

  const handleOpenChange = (val: boolean) => {
    if (!val) {
      setStep('pick');
      setDetectedLocation(null);
    }
    onOpenChange(val);
  };

  const isSelected = (id: string) => browsingLocation?.id === id;

  // When confirming, render fullscreen GoogleMapConfirm (portal) instead of Drawer
  if (open && step === 'confirm' && detectedLocation) {
    return (
      <GoogleMapConfirm
        latitude={detectedLocation.lat}
        longitude={detectedLocation.lng}
        name={detectedLocation.label || 'Detected Location'}
        onConfirm={(lat, lng, updatedName) => handleConfirmGps(lat, lng, updatedName)}
        onBack={handleBackFromConfirm}
      />
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className="max-h-[70dvh] overflow-y-auto">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-base font-bold">Browse Near</DrawerTitle>
        </DrawerHeader>

        <div className="space-y-1.5">
          {/* GPS Option */}
          <button
            type="button"
            onClick={handleUseGps}
            disabled={detectingGps}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left"
          >
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {detectingGps ? <Loader2 size={16} className="animate-spin text-primary" /> : <Navigation size={16} className="text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">Use Current Location</p>
              <p className="text-[11px] text-muted-foreground">Detect via GPS</p>
            </div>
            {isSelected('gps') && <Check size={16} className="text-primary shrink-0" />}
          </button>

          {/* Saved Addresses */}
          {addresses.length > 0 && (
            <div className="pt-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider px-1 mb-1.5">Saved Addresses</p>
              {addresses.map(addr => {
                const Icon = LABEL_ICONS[addr.label] || MapPin;
                return (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => handleSelectAddress(addr)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left mb-1.5"
                  >
                    <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                      <Icon size={16} className="text-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{addr.label}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {addr.building_name || addr.full_address || `${addr.flat_number}, ${addr.block}`}
                      </p>
                    </div>
                    {isSelected(addr.id) && <Check size={16} className="text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Add Address */}
          <button
            type="button"
            onClick={handleAddAddress}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-primary/30 hover:bg-primary/5 transition-colors text-left"
          >
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Plus size={16} className="text-primary" />
            </div>
            <p className="text-sm font-semibold text-primary">Add New Address</p>
          </button>

          {/* Society Default */}
          {society?.latitude && society?.longitude && (
            <button
              type="button"
              onClick={handleUseSociety}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center shrink-0">
                <Building size={16} className="text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">Society Default</p>
                <p className="text-[11px] text-muted-foreground truncate">{society.name}</p>
              </div>
              {browsingLocation?.source === 'society' && <Check size={16} className="text-primary shrink-0" />}
            </button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
