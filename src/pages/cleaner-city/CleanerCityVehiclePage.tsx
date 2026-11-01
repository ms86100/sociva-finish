// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCleanerCityVehicles,
  useDeactivateVehicle,
  useUpsertVehicle,
  useUpsertVehicleDocument,
  useVehicleDocuments,
} from '@/hooks/queries/useCleanerCity';
import {
  CLEANER_CITY_DOCUMENT_TYPES,
  CLEANER_CITY_VEHICLE_TYPES,
  WORK_EMAIL_BADGE,
} from '@/lib/cleaner-city/constants';
import { cn } from '@/lib/utils';

export default function CleanerCityVehiclePage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const upsert = useUpsertVehicle();
  const deactivate = useDeactivateVehicle();
  const upsertDoc = useUpsertVehicleDocument();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState<'car' | 'bike'>('car');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [registration, setRegistration] = useState('');
  const [seats, setSeats] = useState(3);
  const [pickupPref, setPickupPref] = useState('');
  const [dropPref, setDropPref] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [docType, setDocType] = useState('registration');
  const [docLabel, setDocLabel] = useState('');
  const [docNotes, setDocNotes] = useState('');

  const { data: docs = [] } = useVehicleDocuments(selectedVehicleId);
  const maxSeats = vehicleType === 'bike' ? 1 : 8;
  const canHost = profile?.role === 'host' || profile?.role === 'both';
  const verified = verification?.status === 'verified';

  useEffect(() => {
    if (vehicleType === 'bike') setSeats(1);
  }, [vehicleType]);

  useEffect(() => {
    if (!selectedVehicleId && vehicles[0]?.id) setSelectedVehicleId(vehicles[0].id);
  }, [vehicles, selectedVehicleId]);

  const activeCount = useMemo(() => vehicles.filter((v) => v.is_active).length, [vehicles]);

  const resetForm = () => {
    setEditingId(null);
    setVehicleType('car');
    setMake('');
    setModel('');
    setColor('');
    setRegistration('');
    setSeats(3);
    setPickupPref('');
    setDropPref('');
    setNotes('');
  };

  const loadVehicle = (id: string) => {
    const v = vehicles.find((x) => x.id === id);
    if (!v) return;
    setEditingId(v.id);
    setSelectedVehicleId(v.id);
    setVehicleType(v.vehicle_type);
    setMake(v.make || '');
    setModel(v.model || '');
    setColor(v.color || '');
    setRegistration(v.registration_number || '');
    setSeats(v.seat_capacity);
    setPickupPref(v.preferred_pickup_label || '');
    setDropPref(v.preferred_drop_label || '');
    setNotes(v.notes || '');
  };

  const save = async () => {
    if (!verified) {
      toast.error('Verify work email before adding a vehicle');
      return;
    }
    if (!canHost) {
      toast.error('Switch role to Host or Both in set up');
      return;
    }
    try {
      const row = await upsert.mutateAsync({
        vehicle_id: editingId,
        vehicle_type: vehicleType,
        make,
        model,
        color,
        registration_number: registration,
        seat_capacity: seats,
        preferred_pickup_label: pickupPref,
        preferred_drop_label: dropPref,
        notes,
      });
      toast.success(editingId ? 'Vehicle updated' : 'Vehicle saved');
      setSelectedVehicleId(row.id);
      setEditingId(row.id);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save vehicle');
    }
  };

  const remove = async (id: string) => {
    try {
      await deactivate.mutateAsync(id);
      toast.success('Vehicle deactivated');
      if (editingId === id) resetForm();
    } catch (e: any) {
      toast.error(e?.message || 'Could not deactivate');
    }
  };

  const saveDoc = async () => {
    if (!selectedVehicleId) {
      toast.error('Select a vehicle first');
      return;
    }
    try {
      await upsertDoc.mutateAsync({
        vehicle_id: selectedVehicleId,
        document_type: docType,
        label: docLabel,
        notes: docNotes,
      });
      toast.success('Document recorded');
      setDocLabel('');
      setDocNotes('');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save document');
    }
  };

  return (
    <AppLayout headerTitle="My vehicle">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-vehicle-page">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold text-foreground">Host vehicle</p>
            <p className="text-xs text-muted-foreground mt-1">
              Cars and bikes only. Bike passenger seats are capped at 1.
            </p>
            <p className="text-[11px] text-muted-foreground mt-2">
              {verified ? WORK_EMAIL_BADGE : 'Work email required'} · {activeCount} active vehicle
              {activeCount === 1 ? '' : 's'}
            </p>
            <div className="mt-3 flex gap-2">
              <Link to="/cleaner-city/offer" className="text-xs font-semibold text-primary">
                Offer a ride
              </Link>
              <span className="text-xs text-muted-foreground">·</span>
              <Link to="/cleaner-city/route" className="text-xs font-semibold text-primary">
                Office & pickup pins
              </Link>
            </div>
          </div>

          {!canHost && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
              Set your role to Host or Both in{' '}
              <Link to="/cleaner-city/setup" className="font-semibold underline">
                set up
              </Link>{' '}
              before adding vehicles.
            </div>
          )}

          <div className="space-y-2">
            {vehicles.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => loadVehicle(v.id)}
                className={cn(
                  'w-full rounded-2xl border p-3 text-left',
                  selectedVehicleId === v.id ? 'border-primary bg-primary/5' : 'border-border bg-card',
                  !v.is_active && 'opacity-60',
                )}
                data-testid={`cleaner-city-vehicle-${v.id}`}
              >
                <p className="text-sm font-semibold capitalize">
                  {v.vehicle_type} · {v.registration_number}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {[v.make, v.model, v.color].filter(Boolean).join(' · ') || 'No make/model'} ·{' '}
                  {v.seat_capacity} seat{v.seat_capacity === 1 ? '' : 's'}
                  {!v.is_active ? ' · inactive' : ''}
                </p>
              </button>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">{editingId ? 'Edit vehicle' : 'Add vehicle'}</p>
            <div className="grid grid-cols-2 gap-2">
              {CLEANER_CITY_VEHICLE_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setVehicleType(t.value)}
                  className={cn(
                    'rounded-xl border px-3 py-2 text-sm font-semibold',
                    vehicleType === t.value
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Make</Label>
                <Input value={make} onChange={(e) => setMake(e.target.value)} />
              </div>
              <div>
                <Label>Model</Label>
                <Input value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Color</Label>
                <Input value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
              <div>
                <Label>Seats (passengers)</Label>
                <Input
                  type="number"
                  min={1}
                  max={maxSeats}
                  value={seats}
                  onChange={(e) => setSeats(Number(e.target.value))}
                  data-testid="cleaner-city-vehicle-seats"
                />
              </div>
            </div>
            <div>
              <Label>Registration number</Label>
              <Input
                value={registration}
                onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                placeholder="KA01AB1234"
                data-testid="cleaner-city-vehicle-reg"
              />
            </div>
            <div>
              <Label>Preferred pickup</Label>
              <Input value={pickupPref} onChange={(e) => setPickupPref(e.target.value)} />
            </div>
            <div>
              <Label>Preferred drop</Label>
              <Input value={dropPref} onChange={(e) => setDropPref(e.target.value)} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button onClick={save} disabled={upsert.isPending} data-testid="cleaner-city-vehicle-save">
                {editingId ? 'Update vehicle' : 'Save vehicle'}
              </Button>
              {editingId && (
                <>
                  <Button type="button" variant="outline" onClick={resetForm}>
                    New
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => remove(editingId)}>
                    Deactivate
                  </Button>
                </>
              )}
            </div>
          </div>

          {selectedVehicleId && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold">Vehicle documents</p>
              <p className="text-xs text-muted-foreground">
                Record registration, insurance, or licence references. Admin verification comes later.
              </p>
              <div className="flex flex-wrap gap-2">
                {CLEANER_CITY_DOCUMENT_TYPES.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDocType(d.value)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-semibold',
                      docType === d.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border',
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <Input
                placeholder="Label (optional)"
                value={docLabel}
                onChange={(e) => setDocLabel(e.target.value)}
              />
              <Input
                placeholder="Notes / reference"
                value={docNotes}
                onChange={(e) => setDocNotes(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={saveDoc} disabled={upsertDoc.isPending}>
                Record document
              </Button>
              <div className="space-y-2">
                {docs.map((d) => (
                  <div key={d.id} className="rounded-xl border border-border px-3 py-2 text-xs">
                    <span className="font-semibold capitalize">{d.document_type}</span> · {d.status}
                    {d.label ? ` · ${d.label}` : ''}
                    {d.notes ? ` - ${d.notes}` : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
