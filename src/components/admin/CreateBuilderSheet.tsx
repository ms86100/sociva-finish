// @ts-nocheck
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Plus, MapPin, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { friendlyError } from '@/lib/utils';
import { useAutocomplete, PlacePrediction } from '@/hooks/useGoogleMaps';
import { GoogleMapConfirm } from '@/components/auth/GoogleMapConfirm';

interface CreateBuilderSheetProps {
  onCreated: () => void;
}

export function CreateBuilderSheet({ onCreated }: CreateBuilderSheetProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { predictions, isSearching, searchPlaces, getPlaceDetails, clearPredictions, isLoaded } = useAutocomplete();

  const [form, setForm] = useState({
    name: '',
    slug: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    latitude: 0,
    longitude: 0,
  });

  const [step, setStep] = useState<'form' | 'map'>('form');
  const [locationName, setLocationName] = useState('');

  const updateField = (key: string, value: string) => {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      // Auto-generate slug from name
      if (key === 'name') {
        next.slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      }
      return next;
    });
  };

  const handlePlaceSelect = async (prediction: PlacePrediction) => {
    clearPredictions();
    const details = await getPlaceDetails(prediction.placeId);
    if (details) {
      setForm(prev => ({
        ...prev,
        address: details.formattedAddress,
        latitude: details.latitude,
        longitude: details.longitude,
      }));
      setLocationName(details.name || details.formattedAddress.split(',')[0]);
      setStep('map');
    }
  };

  const handleMapConfirm = (lat: number, lng: number, updatedName?: string, _formattedAddress?: string) => {
    setForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
    if (updatedName) setLocationName(updatedName);
    setStep('form');
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error('Name and slug are required');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('builders').insert({
      name: form.name.trim(),
      slug: form.slug.trim(),
      contact_email: form.contact_email.trim() || null,
      contact_phone: form.contact_phone.trim() || null,
      address: form.address || null,
      latitude: form.latitude || null,
      longitude: form.longitude || null,
    });
    setSaving(false);

    if (error) {
      if (error.code === '23505') toast.error('A builder with this slug already exists');
      else toast.error(friendlyError(error));
      return;
    }

    await logAudit('builder_created', 'builder', '', null, { name: form.name, slug: form.slug });
    toast.success('Builder created successfully');
    resetForm();
    setOpen(false);
    await onCreated();
  };

  const resetForm = () => {
    setForm({ name: '', slug: '', contact_email: '', contact_phone: '', address: '', latitude: 0, longitude: 0 });
    setStep('form');
    setLocationName('');
    clearPredictions();
  };

  const handleSearchChange = useCallback((value: string) => {
    updateField('address', value);
    searchPlaces(value);
  }, [searchPlaces]);

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1">
          <Plus size={14} /> Add Builder
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{step === 'map' ? 'Confirm Location' : 'Create New Builder'}</SheetTitle>
        </SheetHeader>

        {step === 'map' && form.latitude !== 0 ? (
          <div className="mt-4">
            <GoogleMapConfirm
              latitude={form.latitude}
              longitude={form.longitude}
              name={locationName}
              onConfirm={handleMapConfirm}
              onBack={() => setStep('form')}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {/* Name */}
            <div>
              <Label className="text-xs">Builder Name *</Label>
              <Input
                value={form.name}
                onChange={e => updateField('name', e.target.value)}
                placeholder="e.g. Prestige Group"
              />
            </div>

            {/* Slug */}
            <div>
              <Label className="text-xs">Slug (auto-generated) *</Label>
              <Input
                value={form.slug}
                onChange={e => updateField('slug', e.target.value)}
                placeholder="prestige-group"
                className="font-mono text-xs"
              />
            </div>

            {/* Contact */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={form.contact_email}
                  onChange={e => updateField('contact_email', e.target.value)}
                  placeholder="info@builder.com"
                />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input
                  type="tel"
                  value={form.contact_phone}
                  onChange={e => updateField('contact_phone', e.target.value)}
                  placeholder="+91..."
                />
              </div>
            </div>

            {/* Location Search */}
            <div className="relative">
              <Label className="text-xs">Office Location</Label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
                <Input
                  value={form.address}
                  onChange={e => handleSearchChange(e.target.value)}
                  placeholder="Search builder office address..."
                  className="pl-9"
                />
                {isSearching && <Loader2 size={14} className="absolute right-3 top-3 animate-spin text-muted-foreground" />}
              </div>

              {/* Predictions dropdown */}
              {predictions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {predictions.map(p => (
                    <button
                      key={p.placeId}
                      type="button"
                      className="w-full text-left px-3 py-2.5 hover:bg-accent transition-colors border-b border-border/50 last:border-0"
                      onClick={() => handlePlaceSelect(p)}
                    >
                      <p className="text-sm font-medium truncate">{p.mainText}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{p.secondaryText}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Location confirmed badge */}
            {form.latitude !== 0 && (
              <div className="flex items-center gap-2 p-2.5 bg-primary/5 rounded-xl border border-primary/20">
                <MapPin size={14} className="text-primary shrink-0" />
                <span className="text-xs font-medium truncate">{locationName || form.address}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto text-xs h-6 px-2"
                  onClick={() => setStep('map')}
                >
                  Adjust
                </Button>
              </div>
            )}

            <Button
              className="w-full h-12 rounded-xl font-semibold"
              onClick={handleSubmit}
              disabled={saving || !form.name.trim() || !form.slug.trim()}
            >
              {saving ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
              Create Builder
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
