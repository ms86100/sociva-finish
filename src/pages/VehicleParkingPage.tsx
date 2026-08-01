// @ts-nocheck
import { useState, useEffect } from 'react';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { Car, Bike, AlertTriangle, Plus, ParkingSquare, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { ModuleSearchBar } from '@/components/search/ModuleSearchBar';

interface ParkingSlot {
  id: string;
  slot_number: string;
  slot_type: string;
  vehicle_number: string | null;
  vehicle_type: string | null;
  is_occupied: boolean;
  assigned_to: string | null;
  resident_id: string | null;
  flat_number: string | null;
}

interface ParkingViolation {
  id: string;
  vehicle_number: string | null;
  violation_type: string;
  description: string | null;
  status: string;
  created_at: string;
  reported_by: string;
}

export default function VehicleParkingPage() {
  const { profile, effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const [slots, setSlots] = useState<ParkingSlot[]>([]);
  const [violations, setViolations] = useState<ParkingViolation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [addSlotOpen, setAddSlotOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Add slot form
  const [slotNumber, setSlotNumber] = useState('');
  const [slotType, setSlotType] = useState('car');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [slotFlatNumber, setSlotFlatNumber] = useState('');

  // Report violation form
  const [violationVehicle, setViolationVehicle] = useState('');
  const [violationType, setViolationType] = useState('unauthorized');
  const [violationDesc, setViolationDesc] = useState('');

  const canManage = isSocietyAdmin || isAdmin;

  useEffect(() => {
    if (!effectiveSocietyId) return;
    fetchData();
  }, [effectiveSocietyId]);

  const fetchData = async () => {
    if (!effectiveSocietyId) return;
    try {
      const [slotsRes, violationsRes] = await Promise.all([
        supabase.from('parking_slots').select('*').eq('society_id', effectiveSocietyId).order('slot_number'),
        supabase.from('parking_violations').select('*').eq('society_id', effectiveSocietyId).order('created_at', { ascending: false }).limit(50),
      ]);
      setSlots((slotsRes.data as unknown as ParkingSlot[]) || []);
      setViolations((violationsRes.data as ParkingViolation[]) || []);
    } catch (error) {
      toast.error('Could not load parking data. Please try again.');
      console.error('Error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const addSlot = async () => {
    if (!effectiveSocietyId || !slotNumber.trim()) return;
    try {
      const { error } = await supabase.from('parking_slots').insert({
        society_id: effectiveSocietyId,
        slot_number: slotNumber.trim(),
        slot_type: slotType,
        vehicle_number: vehicleNumber.trim() || null,
        is_occupied: !!vehicleNumber.trim(),
        assigned_to: vehicleNumber.trim() ? profile?.id : null,
        flat_number: slotFlatNumber.trim() || null,
      } as any);
      if (error) throw error;
      toast.success('Parking slot added');
      setAddSlotOpen(false);
      setSlotNumber('');
      setVehicleNumber('');
      fetchData();
    } catch (error: any) {
      if (error?.code === '23505') toast.error('Slot number already exists');
      else toast.error(friendlyError(error));
    }
  };

  const reportViolation = async () => {
    if (!effectiveSocietyId || !profile) return;
    try {
      const { error } = await supabase.from('parking_violations').insert({
        society_id: effectiveSocietyId,
        reported_by: profile.id,
        vehicle_number: violationVehicle.trim() || null,
        violation_type: violationType,
        description: violationDesc.trim() || null,
      });
      if (error) throw error;
      toast.success('Violation reported');
      setReportOpen(false);
      setViolationVehicle('');
      setViolationDesc('');
      fetchData();
    } catch {
      toast.error('Failed to report violation. Please try again.');
    }
  };

  const resolveViolation = async (id: string, status: 'resolved' | 'dismissed') => {
    if (!effectiveSocietyId) return;
    try {
      await supabase.from('parking_violations').update({ 
        status, 
        resolved_at: new Date().toISOString(),
        resolved_by: profile?.id 
      }).eq('id', id).eq('society_id', effectiveSocietyId);
      toast.success(`Violation ${status}`);
      fetchData();
    } catch {
      toast.error('Failed to update violation. Please try again.');
    }
  };

  const occupiedCount = slots.filter(s => s.is_occupied).length;
  const openViolations = violations.filter(v => v.status === 'open').length;

  if (isLoading) {
    return (
      <AppLayout headerTitle="Parking" showLocation={false}>
        <div className="p-4 space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Vehicle Parking" showLocation={false}>
      <FeatureGate feature="vehicle_parking">
      <div className="p-4 space-y-4">
        <ModuleSearchBar context="parking" value="" onChange={() => {}} />
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <Card><CardContent className="p-3 text-center">
            <ParkingSquare className="mx-auto text-primary mb-1" size={18} />
             <p className="text-lg font-bold tabular-nums">{slots.length}</p>
            <p className="text-[10px] text-muted-foreground">Total Slots</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <Car className="mx-auto text-warning mb-1" size={18} />
            <p className="text-lg font-bold tabular-nums">{occupiedCount}</p>
            <p className="text-[10px] text-muted-foreground">Occupied</p>
          </CardContent></Card>
          <Card><CardContent className="p-3 text-center">
            <AlertTriangle className="mx-auto text-destructive mb-1" size={18} />
            <p className="text-lg font-bold tabular-nums">{openViolations}</p>
            <p className="text-[10px] text-muted-foreground">Violations</p>
          </CardContent></Card>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          {canManage && (
            <Sheet open={addSlotOpen} onOpenChange={setAddSlotOpen}>
              <SheetTrigger asChild>
                <Button size="sm" className="gap-1"><Plus size={14} /> Add Slot</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader><SheetTitle>Add Parking Slot</SheetTitle></SheetHeader>
                <div className="mt-4 space-y-4">
                  <div><Label>Slot Number</Label><Input value={slotNumber} onChange={e => setSlotNumber(e.target.value)} placeholder="e.g. A-101" /></div>
                  <div><Label>Type</Label>
                    <Select value={slotType} onValueChange={setSlotType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="car">Car</SelectItem>
                        <SelectItem value="bike">Bike/Two-Wheeler</SelectItem>
                        <SelectItem value="visitor">Visitor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                   <div><Label>Vehicle Number (optional)</Label><Input value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="e.g. MH-02-AB-1234" /></div>
                   <div><Label>Flat Number (optional)</Label><Input value={slotFlatNumber} onChange={e => setSlotFlatNumber(e.target.value)} placeholder="e.g. A-101" /></div>
                   <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                     <input type="checkbox" id="visitorSlot" checked={slotType === 'visitor'} onChange={e => setSlotType(e.target.checked ? 'visitor' : 'car')} className="accent-primary" />
                     <Label htmlFor="visitorSlot" className="text-xs cursor-pointer">Mark as visitor parking slot</Label>
                   </div>
                  <Button className="w-full" onClick={addSlot} disabled={!slotNumber.trim()}>Add Slot</Button>
                </div>
              </SheetContent>
            </Sheet>
          )}
          <Sheet open={reportOpen} onOpenChange={setReportOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1"><AlertTriangle size={14} /> Report Violation</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader><SheetTitle>Report Parking Violation</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-4">
                <div><Label>Vehicle Number</Label><Input value={violationVehicle} onChange={e => setViolationVehicle(e.target.value)} placeholder="e.g. MH-02-AB-1234" /></div>
                <div><Label>Type</Label>
                  <Select value={violationType} onValueChange={setViolationType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unauthorized">Unauthorized Parking</SelectItem>
                      <SelectItem value="double_parking">Double Parking</SelectItem>
                      <SelectItem value="blocking">Blocking Exit</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Description</Label><Textarea value={violationDesc} onChange={e => setViolationDesc(e.target.value)} placeholder="Describe the issue..." /></div>
                <Button className="w-full" onClick={reportViolation}>Submit Report</Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <Tabs defaultValue="slots">
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="slots" className="text-xs">Slots ({slots.length})</TabsTrigger>
            <TabsTrigger value="violations" className="text-xs">Violations ({openViolations})</TabsTrigger>
          </TabsList>

          <TabsContent value="slots" className="mt-4 space-y-2">
            {slots.map(slot => (
              <Card key={slot.id} className={slot.is_occupied ? 'border-warning/30' : 'border-success/30'}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center ${slot.is_occupied ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'}`}>
                    {slot.slot_type === 'bike' ? <Bike size={18} /> : <Car size={18} />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{slot.slot_number}</p>
                      <Badge variant="outline" className="text-[10px] capitalize">{slot.slot_type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {slot.vehicle_number || (slot.is_occupied ? 'Occupied' : 'Available')}
                      {(slot as any).flat_number && ` · Flat ${(slot as any).flat_number}`}
                    </p>
                  </div>
                  <Badge variant={slot.is_occupied ? 'secondary' : 'default'} className="text-[10px]">
                    {slot.is_occupied ? 'Occupied' : 'Free'}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {slots.length === 0 && (
              <p className="text-center text-muted-foreground py-8 text-sm">No parking slots configured yet</p>
            )}
          </TabsContent>

          <TabsContent value="violations" className="mt-4 space-y-2">
            {violations.map(v => (
              <Card key={v.id} className={v.status === 'open' ? 'border-destructive/30' : ''}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm capitalize">{v.violation_type.replace('_', ' ')}</p>
                        <Badge variant={v.status === 'open' ? 'destructive' : 'secondary'} className="text-[10px]">{v.status}</Badge>
                      </div>
                      {v.vehicle_number && <p className="text-xs text-muted-foreground mt-0.5">{v.vehicle_number}</p>}
                      {v.description && <p className="text-xs mt-1">{v.description}</p>}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {new Date(v.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {v.status === 'open' && canManage && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive" onClick={() => resolveViolation(v.id, 'dismissed')}>Dismiss</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-primary" onClick={() => resolveViolation(v.id, 'resolved')}>Resolve</Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {violations.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <p className="text-sm">No violations reported</p>
                <p className="text-xs mt-1">Report unauthorized parking or blocking issues for committee review.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
