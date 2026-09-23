// @ts-nocheck
import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGoogleMaps, useAutocomplete } from '@/hooks/useGoogleMaps';
import { ArrowLeft, Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import { toast } from 'sonner';

export type ManualPlacePick = {
  lat: number;
  lng: number;
  label: string;
};

type Props = {
  onBack: () => void;
  onPickPlace: (place: ManualPlacePick) => void;
  onUseLocation: () => void;
  busy?: boolean;
};

/**
 * Address textbox + Google Places suggestions for discovery manual pick.
 */
export function DiscoveryManualSearch({ onBack, onPickPlace, onUseLocation, busy }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { isLoaded: mapsLoaded } = useGoogleMaps();
  const { predictions, isSearching, searchPlaces, getPlaceDetails, clearPredictions } = useAutocomplete();
  const blocked = loading || busy;

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, []);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      if (mapsLoaded) searchPlaces(value);
    },
    [mapsLoaded, searchPlaces],
  );

  const handleSelectPlace = useCallback(
    async (placeId: string) => {
      if (blocked) return;
      setLoading(true);
      clearPredictions();
      try {
        const details = await getPlaceDetails(placeId);
        if (details?.latitude != null && details?.longitude != null && (details.latitude || details.longitude)) {
          onPickPlace({
            lat: details.latitude,
            lng: details.longitude,
            label: details.name || details.formattedAddress || 'Selected place',
          });
        } else {
          toast.error('Could not get location details. Try another place.');
        }
      } catch {
        toast.error('Failed to fetch place details.');
      } finally {
        setLoading(false);
      }
    },
    [blocked, clearPredictions, getPlaceDetails, onPickPlace],
  );

  const handleGpsFromManual = () => {
    if (blocked) return;
    onUseLocation();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background flex flex-col" data-ptr-block="true">
      <div className="shrink-0 flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top,0px),12px)] pb-3 border-b border-border">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="text-base font-semibold text-foreground">Select location manually</h2>
      </div>

      <div className="shrink-0 px-4 pt-3 pb-2 space-y-2">
        <p className="text-sm text-muted-foreground">
          Type your society, locality, or address - then confirm the pin on the map.
        </p>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search address, society, or area…"
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10 pr-10 h-12 rounded-xl text-base"
            inputMode="search"
            autoComplete="off"
            enterKeyHint="search"
          />
          {searchInput && !isSearching && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                clearPredictions();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5"
              aria-label="Clear"
            >
              <X size={16} className="text-muted-foreground" />
            </button>
          )}
          {isSearching && (
            <Loader2
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-6">
        {predictions.length > 0 ? (
          <div className="border border-border rounded-xl overflow-hidden divide-y divide-border mb-4">
            {predictions.map((p) => (
              <button
                key={p.placeId}
                type="button"
                onClick={() => handleSelectPlace(p.placeId)}
                disabled={blocked}
                className="w-full text-left px-3 py-3 hover:bg-accent/50 active:bg-accent/70 transition-colors flex items-start gap-3"
              >
                <MapPin size={16} className="text-primary shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{p.mainText}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full h-12 gap-2 rounded-xl font-semibold"
              onClick={() => void handleGpsFromManual()}
              disabled={blocked}
            >
              {busy || loading ? <Loader2 className="animate-spin" size={18} /> : <Navigation size={18} />}
              Use my location instead
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
