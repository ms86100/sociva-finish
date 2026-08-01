// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerTrigger
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { useActionLoading } from '@/hooks/useActionLoading';
import { Package, Plus, CheckCircle, Clock, PackageOpen, Loader2, Search } from 'lucide-react';
import { ImageUpload } from '@/components/ui/image-upload';

type ParcelStatus = 'received' | 'notified' | 'collected' | 'returned';

const statusConfig: Record<ParcelStatus, { label: string; color: string }> = {
  received: { label: 'Received', color: 'bg-warning/10 text-warning' },
  notified: { label: 'Notified', color: 'bg-info/10 text-info' },
  collected: { label: 'Collected', color: 'bg-success/10 text-success' },
  returned: { label: 'Returned', color: 'bg-muted text-muted-foreground' },
};

interface ParcelEntry {
  id: string;
  courier_name: string | null;
  tracking_number: string | null;
  description: string | null;
  status: ParcelStatus;
  received_at: string;
  collected_at: string | null;
  collected_by: string | null;
  flat_number: string | null;
  created_at: string;
  resident_id: string;
  logged_by: string | null;
}

export default function ParcelManagementPage() {
  const { user, profile, effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const [parcels, setParcels] = useState<ParcelEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const { loadingId, withLoading } = useActionLoading();

  // Form
  const [courierName, setCourierName] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Guard-specific: flat number lookup
  const canLogParcels = isSocietyAdmin || isAdmin;
  const [guardFlatNumber, setGuardFlatNumber] = useState('');
  const [guardResidentId, setGuardResidentId] = useState<string | null>(null);
  const [guardResidentName, setGuardResidentName] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  const fetchParcels = useCallback(async () => {
    if (!effectiveSocietyId || !user) return;
    setIsLoading(true);

    let query = canLogParcels
      ? supabase.from('parcel_entries').select('*').eq('society_id', effectiveSocietyId)
      : supabase.from('parcel_entries').select('*').eq('resident_id', user.id);

    query = query.order('created_at', { ascending: false });

    if (activeTab === 'pending') {
      query = query.in('status', ['received', 'notified']);
    } else {
      query = query.in('status', ['collected', 'returned']);
    }

    const { data, error } = await query.limit(50);
    if (error) {
      toast.error('Could not load parcels. Please try again.');
      console.error(error);
    }
    setParcels((data as ParcelEntry[]) || []);
    setIsLoading(false);
  }, [effectiveSocietyId, user, activeTab, canLogParcels]);

  useEffect(() => { fetchParcels(); }, [fetchParcels]);

  const lookupResident = async () => {
    if (!guardFlatNumber.trim() || !effectiveSocietyId) return;
    setIsSearching(true);
    setGuardResidentId(null);
    setGuardResidentName('');

    const { data } = await supabase
      .from('profiles')
      .select('id, name, flat_number')
      .eq('society_id', effectiveSocietyId)
      .eq('flat_number', guardFlatNumber.trim())
      .eq('verification_status', 'approved')
      .limit(1)
      .maybeSingle();

    if (data) {
      setGuardResidentId(data.id);
      setGuardResidentName(data.name || 'Resident');
    } else {
      toast.error('No resident found for this flat number');
    }
    setIsSearching(false);
  };

  // Photo capture state
  const [parcelPhotoUrl, setParcelPhotoUrl] = useState<string | null>(null);

  const handleAddParcel = async () => {
    if (!user || !effectiveSocietyId) return;

    const targetResidentId = canLogParcels ? guardResidentId : user.id;
    const targetFlat = canLogParcels ? guardFlatNumber.trim() : (profile?.flat_number || null);

    if (!targetResidentId) {
      toast.error(canLogParcels ? 'Look up a resident first' : 'Missing user');
      return;
    }

    setIsSubmitting(true);

    if (!effectiveSocietyId) {
      toast.error('No society selected. Please select your society first.');
      setIsSubmitting(false);
      return;
    }

    const { error } = await supabase.from('parcel_entries').insert({
      society_id: effectiveSocietyId,
      resident_id: targetResidentId,
      courier_name: courierName || null,
      tracking_number: trackingNumber || null,
      description: description || null,
      flat_number: targetFlat,
      status: 'received',
      logged_by: canLogParcels ? user.id : null,
      photo_url: parcelPhotoUrl,
    });

    if (error) {
      toast.error(friendlyError(error));
      console.error(error);
    } else {
      toast.success(canLogParcels ? `Parcel logged for Flat ${targetFlat}` : 'Parcel logged');
      setIsAddOpen(false);
      setCourierName(''); setTrackingNumber(''); setDescription('');
      setGuardFlatNumber(''); setGuardResidentId(null); setGuardResidentName('');
      setParcelPhotoUrl(null);
      fetchParcels();
    }
    setIsSubmitting(false);
  };

  const handleCollect = withLoading(async (id: string) => {
    if (!user) return;
    const updateData: Record<string, any> = {
      status: 'collected',
      collected_at: new Date().toISOString(),
      collected_by: profile?.name || 'Resident',
    };
    
    let query = supabase.from('parcel_entries').update(updateData).eq('id', id);
    if (!canLogParcels) {
      query = query.eq('resident_id', user.id);
    }
    const { error } = await query;
    if (!error) { toast.success('Parcel marked as collected'); fetchParcels(); }
  });

  return (
    <AppLayout headerTitle="Parcels & Deliveries" showLocation={false}>
      <FeatureGate feature="parcel_management">
      <div className="p-4 space-y-4">
        {/* Summary */}
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Package className="text-primary" size={24} />
              </div>
              <div>
                <p className="font-semibold">{canLogParcels ? 'All Parcels' : 'My Parcels'}</p>
                <p className="text-2xl font-bold text-primary tabular-nums">{parcels.length}</p>
              </div>
            </div>
            <Drawer open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DrawerTrigger asChild>
                <Button size="sm"><Plus size={16} className="mr-1" /> Log</Button>
              </DrawerTrigger>
              <DrawerContent className="max-h-[80vh] overflow-y-auto">
                <DrawerHeader>
                  <DrawerTitle>{canLogParcels ? 'Log Parcel for Resident' : 'Log a Parcel'}</DrawerTitle>
                  <DrawerDescription>{canLogParcels ? 'Enter flat number to identify the resident' : 'Record a delivery for tracking'}</DrawerDescription>
                </DrawerHeader>
                <div className="space-y-4 py-4">
                  {canLogParcels && (
                    <div className="space-y-2 p-3 bg-muted rounded-lg">
                      <Label className="font-semibold">Resident Flat Number</Label>
                      <div className="flex gap-2">
                        <Input
                          value={guardFlatNumber}
                          onChange={e => { setGuardFlatNumber(e.target.value); setGuardResidentId(null); }}
                          placeholder="e.g., A-101"
                          className="flex-1"
                        />
                        <Button onClick={lookupResident} disabled={isSearching || !guardFlatNumber.trim()} size="sm">
                          {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                        </Button>
                      </div>
                      {guardResidentId && (
                        <p className="text-sm text-success flex items-center gap-1">
                          <CheckCircle size={14} /> Found: {guardResidentName}
                        </p>
                      )}
                    </div>
                  )}
                  <div>
                    <Label>Courier / Platform</Label>
                    <Input value={courierName} onChange={e => setCourierName(e.target.value)} placeholder="e.g., Amazon, Flipkart, Swiggy" />
                  </div>
                  <div>
                    <Label>Tracking Number</Label>
                    <Input value={trackingNumber} onChange={e => setTrackingNumber(e.target.value)} placeholder="Optional" />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="e.g., Small brown box" />
                  </div>
                  {canLogParcels && (
                    <div>
                      <Label>Parcel Photo (optional)</Label>
                      <ImageUpload
                        value={parcelPhotoUrl}
                        onChange={setParcelPhotoUrl}
                        folder="parcels"
                        userId={user?.id || ''}
                        placeholder="Capture parcel photo"
                      />
                    </div>
                  )}
                  <Button
                    onClick={handleAddParcel}
                    disabled={isSubmitting || (canLogParcels && !guardResidentId)}
                    className="w-full"
                  >
                    {isSubmitting ? <><Loader2 size={16} className="mr-1 animate-spin" /> Logging...</> : 'Log Parcel'}
                  </Button>
                </div>
              </DrawerContent>
            </Drawer>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full grid grid-cols-2">
            <TabsTrigger value="pending" className="text-xs">Pending</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">Collected</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-3 space-y-3">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
            ) : parcels.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <PackageOpen className="mx-auto mb-3" size={32} />
                <p className="text-sm">{activeTab === 'pending' ? 'No pending parcels' : 'No collection history'}</p>
              </div>
            ) : (
              parcels.map(parcel => (
                <Card key={parcel.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold">{parcel.courier_name || 'Unknown Courier'}</p>
                          <Badge variant="outline" className={`text-[10px] ${statusConfig[parcel.status].color}`}>
                            {statusConfig[parcel.status].label}
                          </Badge>
                        </div>
                        {parcel.flat_number && canLogParcels && (
                          <p className="text-xs font-medium text-primary mt-0.5">Flat {parcel.flat_number}</p>
                        )}
                        {parcel.description && (
                          <p className="text-xs text-muted-foreground mt-1">{parcel.description}</p>
                        )}
                        {parcel.tracking_number && (
                          <p className="text-xs text-muted-foreground mt-0.5 font-mono">{parcel.tracking_number}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                          <Clock size={10} /> {new Date(parcel.received_at).toLocaleString()}
                        </p>
                        {parcel.collected_at && (
                          <p className="text-[10px] text-muted-foreground">
                            Collected: {new Date(parcel.collected_at).toLocaleString()}
                            {parcel.collected_by && ` by ${parcel.collected_by}`}
                          </p>
                        )}
                      </div>

                      {(parcel.status === 'received' || parcel.status === 'notified') && (
                        <Button size="sm" variant="default" onClick={() => handleCollect(parcel.id)} disabled={loadingId === parcel.id}>
                          {loadingId === parcel.id ? <Loader2 size={14} className="mr-1 animate-spin" /> : <CheckCircle size={14} className="mr-1" />} Collect
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
