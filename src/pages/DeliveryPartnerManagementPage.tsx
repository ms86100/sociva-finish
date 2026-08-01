// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Truck, Plus, Phone, Star, Package, User, Loader2 } from 'lucide-react';
import { ImageUpload } from '@/components/ui/image-upload';

export default function DeliveryPartnerManagementPage() {
  const { user, profile, effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const canManage = isSocietyAdmin || isAdmin;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('bike');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ['delivery-partners', effectiveSocietyId],
    queryFn: async () => {
      if (!effectiveSocietyId) return [];
      const { data } = await supabase
        .from('delivery_partner_pool')
        .select('*')
        .eq('society_id', effectiveSocietyId)
        .order('created_at', { ascending: false });
      return data || [];
    },
    enabled: !!effectiveSocietyId,
  });

  const handleAdd = async () => {
    if (!name.trim() || !phone.trim() || !effectiveSocietyId || !user) return;
    setIsSubmitting(true);

    const writeSocietyId = profile?.society_id || effectiveSocietyId;
    const { error } = await supabase.from('delivery_partner_pool').insert({
      society_id: writeSocietyId,
      name: name.trim(),
      phone: phone.trim(),
      vehicle_type: vehicleType,
      vehicle_number: vehicleNumber.trim() || null,
      photo_url: photoUrl,
      added_by: user.id,
    });

    if (error) {
      toast.error('Failed to add partner');
    } else {
      toast.success('Delivery partner added');
      setIsAddOpen(false);
      setName(''); setPhone(''); setVehicleNumber(''); setPhotoUrl(null);
      queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
    }
    setIsSubmitting(false);
  };

  const toggleAvailability = async (id: string, current: boolean) => {
    await supabase.from('delivery_partner_pool')
      .update({ is_available: !current, updated_at: new Date().toISOString() })
      .eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('delivery_partner_pool')
      .update({ is_active: !current, updated_at: new Date().toISOString() })
      .eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['delivery-partners'] });
  };

  if (!canManage) {
    return (
      <AppLayout headerTitle="Delivery Partners" showLocation={false}>
        <div className="p-4 text-center py-20 text-muted-foreground">
          <Truck size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">Access Restricted</p>
          <p className="text-sm">Only society admins can manage delivery partners.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Delivery Partners" showLocation={false}>
      <FeatureGate feature="delivery_management">
      <div className="p-4 space-y-4">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Truck className="text-primary" size={24} />
              </div>
              <div>
                <p className="font-semibold">Delivery Pool</p>
                <p className="text-2xl font-bold text-primary tabular-nums">{partners.filter(p => p.is_active).length}</p>
              </div>
            </div>
            <Drawer open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DrawerTrigger asChild>
                <Button size="sm"><Plus size={16} className="mr-1" /> Add</Button>
              </DrawerTrigger>
              <DrawerContent className="max-h-[80vh] overflow-y-auto">
                <DrawerHeader>
                  <DrawerTitle>Add Delivery Partner</DrawerTitle>
                </DrawerHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label>Name *</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder="Rider name" />
                  </div>
                  <div>
                    <Label>Phone *</Label>
                    <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone number" inputMode="tel" />
                  </div>
                  <div>
                    <Label>Vehicle Type</Label>
                    <Select value={vehicleType} onValueChange={setVehicleType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bike">Bike</SelectItem>
                        <SelectItem value="scooter">Scooter</SelectItem>
                        <SelectItem value="bicycle">Bicycle</SelectItem>
                        <SelectItem value="car">Car</SelectItem>
                        <SelectItem value="van">Van</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Vehicle Number</Label>
                    <Input value={vehicleNumber} onChange={e => setVehicleNumber(e.target.value)} placeholder="e.g., KA-01-AB-1234" />
                  </div>
                  <div>
                    <Label>Photo</Label>
                    <ImageUpload value={photoUrl} onChange={setPhotoUrl} folder="delivery-partners" userId={user?.id || ''} placeholder="Upload photo" />
                  </div>
                  <Button onClick={handleAdd} disabled={isSubmitting || !name.trim() || !phone.trim()} className="w-full">
                    {isSubmitting ? <Loader2 size={16} className="mr-1 animate-spin" /> : null}
                    Add Partner
                  </Button>
                </div>
              </DrawerContent>
            </Drawer>
          </CardContent>
        </Card>

        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : partners.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Truck className="mx-auto mb-3" size={32} />
            <p className="text-sm">No delivery partners registered</p>
            <p className="text-xs mt-1">Add riders to manage your society's delivery pool</p>
          </div>
        ) : (
          <div className="space-y-3">
            {partners.map(partner => (
              <Card key={partner.id} className={!partner.is_active ? 'opacity-60' : ''}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    {partner.photo_url ? (
                      <img src={partner.photo_url} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <User size={20} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{partner.name}</p>
                        <Badge variant={partner.is_available ? 'default' : 'secondary'} className="text-[10px]">
                          {partner.is_available ? 'Available' : 'Busy'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Phone size={12} className="text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">{partner.phone}</p>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[10px] text-muted-foreground capitalize">{partner.vehicle_type}</span>
                        {partner.vehicle_number && (
                          <span className="text-[10px] font-mono text-muted-foreground">{partner.vehicle_number}</span>
                        )}
                        <div className="flex items-center gap-0.5">
                          <Package size={10} className="text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground">{partner.total_deliveries}</span>
                        </div>
                        {partner.rating > 0 && (
                          <div className="flex items-center gap-0.5">
                            <Star size={10} className="text-warning" />
                            <span className="text-[10px]">{partner.rating}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">Available</span>
                        <Switch checked={partner.is_available} onCheckedChange={() => toggleAvailability(partner.id, partner.is_available)} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-muted-foreground">Active</span>
                        <Switch checked={partner.is_active} onCheckedChange={() => toggleActive(partner.id, partner.is_active)} />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
