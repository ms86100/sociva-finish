// @ts-nocheck
import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MapPin, Navigation, Loader2, Home, Briefcase, Tag, Search, X, Plus, Pencil, Trash2 } from 'lucide-react';
import { getCurrentPosition } from '@/lib/native-location';
import { GoogleMapConfirm } from '@/components/auth/GoogleMapConfirm';
import { useAutocomplete } from '@/hooks/useGoogleMaps';
import { extractBestLabel, extractBestFormattedAddress } from '@/lib/location-label-resolver';
import { toast } from 'sonner';
import { notify } from '@/lib/notify';

interface AddressData {
  id?: string;
  label: string;
  flat_number: string;
  block: string;
  floor: string;
  building_name: string;
  landmark: string;
  full_address: string;
  latitude: number | null;
  longitude: number | null;
  pincode: string;
  phase: string;
  is_default: boolean;
}

interface AddressFormProps {
  initial?: Partial<AddressData>;
  onSave: (data: AddressData) => void;
  onCancel: () => void;
  saving?: boolean;
}

const FIXED_LABELS = [
  { value: 'Home', icon: Home },
  { value: 'Work', icon: Briefcase },
];

export function AddressForm({ initial, onSave, onCancel, saving }: AddressFormProps) {
  const [form, setForm] = useState<AddressData>({
    id: initial?.id,
    label: initial?.label || 'Home',
    flat_number: initial?.flat_number || '',
    block: initial?.block || '',
    floor: initial?.floor || '',
    building_name: initial?.building_name || '',
    landmark: initial?.landmark || '',
    full_address: initial?.full_address || '',
    latitude: initial?.latitude ?? null,
    longitude: initial?.longitude ?? null,
    pincode: initial?.pincode || '',
    phase: initial?.phase || '',
    is_default: initial?.is_default ?? false,
  });
  const [detecting, setDetecting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [customLabels, setCustomLabels] = useState<string[]>(() => {
    // If initial label is not Home/Work, it's a custom label
    const fixed = ['Home', 'Work'];
    if (initial?.label && !fixed.includes(initial.label)) {
      return [initial.label];
    }
    return [];
  });
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [editingCustomIndex, setEditingCustomIndex] = useState<number | null>(null);
  const [customInput, setCustomInput] = useState('');

  // Autocomplete state
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const { predictions, isSearching, searchPlaces, getPlaceDetails, clearPredictions, isLoaded } = useAutocomplete();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const update = (key: keyof AddressData, value: any) => setForm(f => ({ ...f, [key]: value }));

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 3) {
      clearPredictions();
      setShowResults(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      searchPlaces(value);
      setShowResults(true);
    }, 300);
  }, [searchPlaces, clearPredictions]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelectPlace = async (placeId: string) => {
    setShowResults(false);
    const details = await getPlaceDetails(placeId);
    if (!details) {
      toast.error('Could not get place details');
      return;
    }
    setForm(f => ({
      ...f,
      latitude: details.latitude,
      longitude: details.longitude,
      full_address: details.formattedAddress,
      building_name: details.name || f.building_name,
      pincode: details.pincode || f.pincode,
    }));
    setSearchQuery(details.name || details.formattedAddress);
    setShowMap(true);
  };

  const detectLocation = async () => {
    setDetecting(true);
    try {
      const pos = await getCurrentPosition();
      // Clear stale society/building data from previous autocomplete selection
      setForm(f => ({ ...f, latitude: pos.latitude, longitude: pos.longitude, building_name: '' }));
      setSearchQuery('');
      clearPredictions();
      setShowMap(true);

      // Reverse geocode with quality resolver
      if ((window as any).google?.maps) {
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ location: { lat: pos.latitude, lng: pos.longitude } }, (results, status) => {
          if (status === 'OK' && results && results.length > 0) {
            const bestLabel = extractBestLabel(results);
            const bestAddress = extractBestFormattedAddress(results);
            const pincode = results[0].address_components?.find(c => c.types.includes('postal_code'))?.long_name || '';
            setForm(f => ({
              ...f,
              full_address: bestAddress || bestLabel?.formattedAddress || results[0].formatted_address,
              pincode: pincode || f.pincode,
            }));
          }
        });
      }
    } catch (err: any) {
      toast.error('Could not detect location. Please enable location access.');
    } finally {
      setDetecting(false);
    }
  };

  const handleMapConfirm = (lat: number, lng: number, name?: string, formattedAddress?: string) => {
    setForm(f => ({
      ...f,
      latitude: lat,
      longitude: lng,
      // Use formattedAddress (full postal address) for full_address field
      // Fall back to name (display label) only if no formatted address available
      full_address: formattedAddress || name || f.full_address,
      // If building_name was already cleared (GPS flow), keep it cleared
      building_name: f.building_name || '',
    }));
    setShowMap(false);
  };

  const handleSubmit = () => {
    if (!form.flat_number.trim()) {
      notify.block('Please enter your flat/house number');
      return;
    }
    onSave(form);
  };

  if (showMap && form.latitude && form.longitude) {
    return (
      <GoogleMapConfirm
        latitude={form.latitude}
        longitude={form.longitude}
        name={form.full_address || form.building_name || 'Your location'}
        onConfirm={handleMapConfirm}
        onBack={() => setShowMap(false)}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Label Chips */}
      <div>
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Address Label</Label>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {/* Fixed labels */}
          {FIXED_LABELS.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => update('label', value)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                form.label === value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card border-border text-muted-foreground hover:border-primary/30'
              }`}
            >
              <Icon size={14} />
              {value}
            </button>
          ))}

          {/* Custom labels */}
          {customLabels.map((cl, idx) => (
            <div key={`custom-${idx}`} className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => update('label', cl)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-l-xl text-xs font-medium border transition-all ${
                  form.label === cl
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:border-primary/30'
                }`}
              >
                <Tag size={14} />
                {cl}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingCustomIndex(idx);
                  setCustomInput(cl);
                  setIsAddingCustom(true);
                }}
                className={`px-1.5 py-2 border-y text-xs transition-all ${
                  form.label === cl
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <Pencil size={10} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const updated = customLabels.filter((_, i) => i !== idx);
                  setCustomLabels(updated);
                  if (form.label === cl) update('label', 'Home');
                }}
                className={`px-1.5 py-2 border-y border-r rounded-r-xl text-xs transition-all ${
                  form.label === cl
                    ? 'bg-primary text-primary-foreground border-primary hover:bg-destructive'
                    : 'bg-card border-border text-muted-foreground hover:text-destructive'
                }`}
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}

          {/* Add custom label button / input */}
          {isAddingCustom ? (
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                value={customInput}
                onChange={e => setCustomInput(e.target.value)}
                placeholder="e.g. Mom's House"
                className="h-8 w-32 text-xs"
                maxLength={20}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const trimmed = customInput.trim();
                    if (!trimmed) return;
                    if (editingCustomIndex !== null) {
                      const updated = [...customLabels];
                      updated[editingCustomIndex] = trimmed;
                      setCustomLabels(updated);
                      if (form.label === customLabels[editingCustomIndex]) update('label', trimmed);
                    } else {
                      setCustomLabels(prev => [...prev, trimmed]);
                      update('label', trimmed);
                    }
                    setCustomInput('');
                    setIsAddingCustom(false);
                    setEditingCustomIndex(null);
                  }
                  if (e.key === 'Escape') {
                    setCustomInput('');
                    setIsAddingCustom(false);
                    setEditingCustomIndex(null);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = customInput.trim();
                  if (!trimmed) { setIsAddingCustom(false); setEditingCustomIndex(null); return; }
                  if (editingCustomIndex !== null) {
                    const updated = [...customLabels];
                    updated[editingCustomIndex] = trimmed;
                    setCustomLabels(updated);
                    if (form.label === customLabels[editingCustomIndex]) update('label', trimmed);
                  } else {
                    setCustomLabels(prev => [...prev, trimmed]);
                    update('label', trimmed);
                  }
                  setCustomInput('');
                  setIsAddingCustom(false);
                  setEditingCustomIndex(null);
                }}
                className="h-8 w-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => { setIsAddingCustom(false); setCustomInput(''); setEditingCustomIndex(null); }}
                className="h-8 w-8 flex items-center justify-center rounded-lg border border-border text-muted-foreground text-xs hover:text-foreground"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setIsAddingCustom(true); setEditingCustomIndex(null); setCustomInput(''); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border border-dashed border-primary/30 text-primary hover:bg-primary/5 transition-all"
            >
              <Plus size={14} />
              Other
            </button>
          )}
        </div>
      </div>

      {/* Google Maps Autocomplete Search */}
      <div ref={searchRef} className="relative">
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Search Society / Location</Label>
        <div className="relative mt-1.5">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Search your society, area, or landmark…"
            className="pl-9 pr-9 h-11"
            disabled={!isLoaded}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); clearPredictions(); setShowResults(false); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Predictions Dropdown */}
        {showResults && predictions.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-xl shadow-lg max-h-60 overflow-y-auto">
            {predictions.map(p => (
              <button
                key={p.placeId}
                type="button"
                onClick={() => handleSelectPlace(p.placeId)}
                className="w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
              >
                <p className="text-sm font-medium text-foreground truncate">{p.mainText}</p>
                <p className="text-xs text-muted-foreground truncate">{p.secondaryText}</p>
              </button>
            ))}
          </div>
        )}

        {showResults && isSearching && (
          <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-xl shadow-lg p-4 flex items-center justify-center gap-2">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Searching…</span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 border-t border-border" />
        <span className="text-[11px] text-muted-foreground uppercase tracking-wide">or</span>
        <div className="flex-1 border-t border-border" />
      </div>

      {/* GPS Detect */}
      <Button
        variant="outline"
        className="w-full h-11 rounded-xl border-dashed border-primary/30 text-primary"
        onClick={detectLocation}
        disabled={detecting}
      >
        {detecting ? (
          <><Loader2 size={16} className="mr-2 animate-spin" /> Detecting location…</>
        ) : (
          <><Navigation size={16} className="mr-2" /> Use current location</>
        )}
      </Button>

      {form.latitude && (
        <button
          type="button"
          onClick={() => setShowMap(true)}
          className="w-full flex items-center gap-2 p-2.5 bg-primary/5 rounded-xl border border-primary/20 text-sm"
        >
          <MapPin size={14} className="text-primary shrink-0" />
          <span className="flex-1 text-left truncate text-xs">{form.full_address || 'Location pinned'}</span>
          <span className="text-xs text-primary font-medium shrink-0">Adjust</span>
        </button>
      )}

      {/* Structured Fields */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="flat" className="text-xs">Flat / House No. *</Label>
          <Input id="flat" value={form.flat_number} onChange={e => update('flat_number', e.target.value)} placeholder="e.g. A-201" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="floor" className="text-xs">Floor</Label>
          <Input id="floor" value={form.floor} onChange={e => update('floor', e.target.value)} placeholder="e.g. 2nd" className="mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="block" className="text-xs">Block / Tower</Label>
          <Input id="block" value={form.block} onChange={e => update('block', e.target.value)} placeholder="e.g. B" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="phase" className="text-xs">Phase</Label>
          <Input id="phase" value={form.phase} onChange={e => update('phase', e.target.value)} placeholder="e.g. Phase 2" className="mt-1" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="building" className="text-xs">Building / Society</Label>
          <Input id="building" value={form.building_name} onChange={e => update('building_name', e.target.value)} placeholder="e.g. Sunshine Residency" className="mt-1" />
        </div>
        <div>
          <Label htmlFor="pincode" className="text-xs">Pincode</Label>
          <Input id="pincode" value={form.pincode} onChange={e => update('pincode', e.target.value)} placeholder="e.g. 400001" className="mt-1" maxLength={6} />
        </div>
      </div>

      <div>
        <Label htmlFor="landmark" className="text-xs">Landmark</Label>
        <Input id="landmark" value={form.landmark} onChange={e => update('landmark', e.target.value)} placeholder="e.g. Near Central Park" className="mt-1" />
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} className="flex-1 h-11 rounded-xl">Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving} className="flex-1 h-11 rounded-xl font-semibold">
          {saving ? <Loader2 size={16} className="mr-1 animate-spin" /> : null}
          {form.id ? 'Update & Continue' : 'Save & Continue'}
        </Button>
      </div>
    </div>
  );
}
