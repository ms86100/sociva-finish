// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Check, FileCheck2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

type VehicleTab = 'vehicle' | 'docs';

export default function CleanerCityVehiclePage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: vehicles = [] } = useCleanerCityVehicles();
  const upsert = useUpsertVehicle();
  const deactivate = useDeactivateVehicle();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const upsertDoc = useUpsertVehicleDocument();

  const [tab, setTab] = useState<VehicleTab>('vehicle');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState<'car' | 'bike'>('car');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [registration, setRegistration] = useState('');
  const [seats, setSeats] = useState(3);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [docType, setDocType] = useState('registration');
  const [docLabel, setDocLabel] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

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

  useEffect(() => {
    if (vehicles.length === 0) setShowForm(true);
  }, [vehicles.length]);

  const activeVehicles = useMemo(() => vehicles.filter((v) => v.is_active), [vehicles]);
  const activeCount = activeVehicles.length;
  const hasDocs = docs.length > 0;
  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) || activeVehicles[0] || null;

  const clearFormFields = () => {
    setEditingId(null);
    setVehicleType('car');
    setMake('');
    setModel('');
    setColor('');
    setRegistration('');
    setSeats(3);
  };

  const startAdd = () => {
    clearFormFields();
    setShowForm(true);
    setTab('vehicle');
  };

  const startEdit = (id: string) => {
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
    setShowForm(true);
    setTab('vehicle');
  };

  const cancelForm = () => {
    clearFormFields();
    setShowForm(activeCount === 0);
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
    if (!registration.trim()) {
      toast.error('Add the registration number');
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
        preferred_pickup_label: null,
        preferred_drop_label: null,
        notes: null,
      });
      setSelectedVehicleId(row.id);
      setEditingId(null);
      setShowForm(false);
      toast.success(editingId ? 'Vehicle updated' : 'Vehicle saved');
    } catch (e: any) {
      toast.error(e?.message || 'Could not save vehicle');
    }
  };

  const remove = async (id: string) => {
    try {
      await deactivate.mutateAsync(id);
      toast.success('Vehicle deactivated');
      clearFormFields();
      setShowForm(true);
    } catch (e: any) {
      toast.error(e?.message || 'Could not deactivate');
    }
  };

  const saveDoc = async () => {
    if (!selectedVehicleId) {
      toast.error('Save a vehicle first');
      setTab('vehicle');
      return;
    }
    if (!docFile) {
      toast.error('Choose a photo or PDF');
      return;
    }
    if (!user?.id) return;
    try {
      const safeName = docFile.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const path = `${user.id}/${selectedVehicleId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('vehicle-documents')
        .upload(path, docFile, { upsert: false, contentType: docFile.type || undefined });
      if (uploadError) throw uploadError;
      await upsertDoc.mutateAsync({
        vehicle_id: selectedVehicleId,
        document_type: docType,
        label: docLabel,
        notes: docNotes,
        storage_path: path,
      });
      toast.success('Uploaded for review');
      setDocLabel('');
      setDocNotes('');
      setDocFile(null);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save document');
    }
  };

  const goOffer = () => {
    navigate('/cleaner-city/offer', {
      state: { notice: 'Pick a date and publish empty seats.' },
    });
  };

  return (
    <CleanerCityChrome headerTitle="My vehicle">
      <CleanerCityGate>
        <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-28 pt-4" data-testid="cleaner-city-vehicle-page">
          {arrivalNotice ? (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm leading-relaxed">
              {arrivalNotice}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
            {[
              { label: 'Vehicle', done: activeCount > 0 },
              { label: 'Docs', done: hasDocs },
              { label: 'Offer', done: false },
            ].map((step, i, arr) => (
              <div key={step.label} className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    step.done ? 'bg-emerald-500/20 text-emerald-500' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {step.done ? <Check size={13} /> : i + 1}
                </span>
                <span
                  className={cn(
                    'truncate text-xs font-semibold',
                    step.done ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {step.label}
                </span>
                {i < arr.length - 1 ? (
                  <span className="ml-auto h-px w-3 shrink-0 bg-border sm:w-5" aria-hidden />
                ) : null}
              </div>
            ))}
          </div>

          {!canHost ? (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm leading-relaxed">
              Set role to Host or Both in{' '}
              <Link to="/cleaner-city/setup" className="font-semibold text-primary underline">
                set up
              </Link>{' '}
              to add a vehicle.
            </div>
          ) : null}

          <Tabs value={tab} onValueChange={(v) => setTab(v as VehicleTab)} className="w-full">
            <TabsList className="grid h-12 w-full grid-cols-2 p-1">
              <TabsTrigger value="vehicle" data-testid="vehicle-tab-details" className="gap-1.5">
                {activeCount > 0 ? <Check size={12} className="text-emerald-500" /> : null}
                Vehicle
              </TabsTrigger>
              <TabsTrigger value="docs" data-testid="vehicle-tab-docs" className="gap-1.5">
                {hasDocs ? <Check size={12} className="text-emerald-500" /> : null}
                Documents
              </TabsTrigger>
            </TabsList>

            <TabsContent value="vehicle" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
                {!showForm && selectedVehicle ? (
                  <>
                    <div className="flex flex-col gap-3">
                      {activeVehicles.map((v) => {
                        const selected = selectedVehicleId === v.id;
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setSelectedVehicleId(v.id)}
                            className={cn(
                              'w-full rounded-2xl border px-4 py-4 text-left',
                              selected ? 'border-primary bg-primary/5' : 'border-border bg-card',
                            )}
                            data-testid={`cleaner-city-vehicle-${v.id}`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-base font-semibold capitalize tracking-tight">
                                  {v.vehicle_type} · {v.registration_number}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {[v.make, v.model, v.color].filter(Boolean).join(' · ') ||
                                    'Details not set'}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {v.seat_capacity} empty seat{v.seat_capacity === 1 ? '' : 's'}
                                </p>
                              </div>
                              {selected ? (
                                <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-500">
                                  Active
                                </span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* One primary action only */}
                    <div className="flex flex-col gap-4">
                      <Button className="h-12 w-full text-base font-semibold" onClick={goOffer}>
                        Offer seats
                      </Button>
                      <div className="flex items-center justify-center gap-5 text-sm">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 font-semibold text-foreground"
                          onClick={() => selectedVehicleId && startEdit(selectedVehicleId)}
                        >
                          <Pencil size={14} />
                          Edit
                        </button>
                        <span className="text-border">|</span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 font-semibold text-primary"
                          onClick={startAdd}
                        >
                          <Plus size={14} />
                          Add another
                        </button>
                      </div>
                      <p className="text-center text-[11px] text-muted-foreground">
                        {verified ? WORK_EMAIL_BADGE : 'Work email required'}
                      </p>
                    </div>
                  </>
                ) : null}

                {showForm ? (
                  <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold">
                        {editingId ? 'Edit vehicle' : 'Add vehicle'}
                      </h2>
                      {activeCount > 0 ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-muted-foreground"
                          onClick={cancelForm}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {CLEANER_CITY_VEHICLE_TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setVehicleType(t.value)}
                          className={cn(
                            'rounded-xl border px-3 py-3 text-sm font-semibold',
                            vehicleType === t.value
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border',
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Label>Registration</Label>
                      <Input
                        value={registration}
                        onChange={(e) => setRegistration(e.target.value.toUpperCase())}
                        placeholder="e.g. KA01AB1234"
                        data-testid="cleaner-city-vehicle-reg"
                        className="h-11"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>Make</Label>
                        <Input
                          value={make}
                          onChange={(e) => setMake(e.target.value)}
                          placeholder="Make"
                          className="h-11"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Model</Label>
                        <Input
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          placeholder="Model"
                          className="h-11"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-2">
                        <Label>Color</Label>
                        <Input
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                          placeholder="Color"
                          className="h-11"
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        <Label>Empty seats</Label>
                        <Input
                          type="number"
                          min={1}
                          max={maxSeats}
                          value={seats}
                          onChange={(e) => setSeats(Number(e.target.value))}
                          data-testid="cleaner-city-vehicle-seats"
                          className="h-11"
                        />
                      </div>
                    </div>

                    <Button
                      className="h-12 w-full text-base font-semibold"
                      onClick={save}
                      disabled={upsert.isPending}
                      data-testid="cleaner-city-vehicle-save"
                    >
                      {editingId ? 'Save changes' : 'Save vehicle'}
                    </Button>

                    {editingId ? (
                      <button
                        type="button"
                        className="text-center text-sm text-muted-foreground"
                        onClick={() => remove(editingId)}
                        disabled={deactivate.isPending}
                      >
                        Deactivate vehicle
                      </button>
                    ) : null}
                  </section>
                ) : null}
              </div>
            </TabsContent>

            <TabsContent value="docs" className="mt-6 focus-visible:outline-none">
              <div className="flex flex-col gap-6">
                {!selectedVehicleId ? (
                  <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-5 py-10 text-center">
                    <FileCheck2 className="text-muted-foreground" size={28} />
                    <p className="text-sm font-semibold">Save a vehicle first</p>
                    <Button type="button" variant="outline" onClick={() => setTab('vehicle')}>
                      Go to vehicle
                    </Button>
                  </div>
                ) : (
                  <>
                    <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-5">
                      <div>
                        <h2 className="text-base font-semibold">Upload document</h2>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                          Registration is enough to start. Verified shows after admin approval.
                        </p>
                      </div>

                      {activeVehicles.length > 1 ? (
                        <div className="flex flex-wrap gap-2">
                          {activeVehicles.map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => setSelectedVehicleId(v.id)}
                              className={cn(
                                'rounded-full border px-3 py-1.5 text-xs font-semibold',
                                selectedVehicleId === v.id
                                  ? 'border-primary bg-primary/10 text-primary'
                                  : 'border-border',
                              )}
                            >
                              {v.registration_number}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        {CLEANER_CITY_DOCUMENT_TYPES.map((d) => (
                          <button
                            key={d.value}
                            type="button"
                            onClick={() => setDocType(d.value)}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-xs font-semibold',
                              docType === d.value
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border',
                            )}
                          >
                            {d.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-col gap-3">
                        <Input
                          type="file"
                          accept="image/jpeg,image/png,image/webp,application/pdf"
                          onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                          data-testid="cleaner-city-vehicle-document-file"
                          className="h-11"
                        />
                        <Input
                          placeholder="Label (optional)"
                          value={docLabel}
                          onChange={(e) => setDocLabel(e.target.value)}
                          className="h-11"
                        />
                        <Input
                          placeholder="Notes (optional)"
                          value={docNotes}
                          onChange={(e) => setDocNotes(e.target.value)}
                          className="h-11"
                        />
                      </div>

                      {/* One primary CTA on this screen */}
                      <Button
                        type="button"
                        className="h-12 w-full text-base font-semibold"
                        onClick={saveDoc}
                        disabled={upsertDoc.isPending}
                      >
                        Upload
                      </Button>
                    </section>

                    {hasDocs ? (
                      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                        <h2 className="text-sm font-semibold">Uploaded</h2>
                        {docs.map((d) => (
                          <div
                            key={d.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3 text-xs"
                          >
                            <span className="min-w-0 truncate font-semibold capitalize">
                              {d.document_type}
                              {d.label ? ` · ${d.label}` : ''}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase',
                                d.status === 'approved' &&
                                  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                                d.status === 'pending' &&
                                  'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                                d.status === 'rejected' && 'bg-destructive/15 text-destructive',
                              )}
                            >
                              {d.status}
                            </span>
                          </div>
                        ))}
                      </section>
                    ) : null}

                    {/* Quiet exit - never a second green button */}
                    <button
                      type="button"
                      onClick={goOffer}
                      className="py-1 text-center text-sm font-semibold text-primary"
                    >
                      Skip for now - offer seats
                    </button>
                  </>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
