// @ts-nocheck
import { useState, useEffect } from 'react';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Users, Plus, Loader2, Phone, Trash2, User } from 'lucide-react';

interface AuthorizedPerson {
  id: string;
  person_name: string;
  relationship: string;
  phone: string | null;
  photo_url: string | null;
  is_active: boolean;
}

const RELATIONSHIPS = ['Family', 'Spouse', 'Parent', 'Child', 'Sibling', 'Relative', 'Tenant', 'Driver', 'Caretaker', 'Other'];

export default function AuthorizedPersonsPage() {
  const { user, profile, effectiveSocietyId } = useAuth();
  const [persons, setPersons] = useState<AuthorizedPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('Family');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (effectiveSocietyId && user) fetchPersons();
  }, [effectiveSocietyId, user]);

  const fetchPersons = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('authorized_persons')
      .select('*')
      .eq('resident_id', user!.id)
      .eq('society_id', effectiveSocietyId!)
      .order('created_at', { ascending: false });
    setPersons((data as AuthorizedPerson[]) || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!name.trim() || !user || !effectiveSocietyId || !profile) return;
    setSubmitting(true);
    const { error } = await supabase.from('authorized_persons').insert({
      resident_id: user.id,
      society_id: effectiveSocietyId,
      person_name: name.trim(),
      relationship,
      phone: phone.trim() || null,
      photo_url: photoUrl,
      flat_number: profile.flat_number || '',
      is_active: true,
    });
    if (error) toast.error('Failed to add person');
    else {
      toast.success('Authorized person added');
      setSheetOpen(false);
      setName(''); setPhone(''); setPhotoUrl(null);
      fetchPersons();
    }
    setSubmitting(false);
  };

  const handleRemove = async (id: string) => {
    const { error } = await supabase.from('authorized_persons')
      .update({ is_active: false })
      .eq('id', id)
      .eq('resident_id', user!.id);
    if (!error) { toast.success('Person removed'); fetchPersons(); }
  };

  if (loading) return (
    <AppLayout headerTitle="Authorized Persons" showLocation={false}>
      <div className="p-4 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
    </AppLayout>
  );

  return (
    <AppLayout headerTitle="Authorized Persons" showLocation={false}>
      <FeatureGate feature={["visitor_management", "authorized_persons"]}>
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          Family members and trusted individuals authorized for gate entry without OTP.
        </p>

        <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
          <DrawerTrigger asChild>
            <Button size="sm" className="gap-1"><Plus size={14} /> Add Person</Button>
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader><DrawerTitle>Add Authorized Person</DrawerTitle></DrawerHeader>
            <div className="space-y-4 px-4 pb-6">
              <div><Label>Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" /></div>
              <div><Label>Relationship</Label>
                <Select value={relationship} onValueChange={setRelationship}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 XXXXX XXXXX" /></div>
              <div>
                <Label>Photo (optional)</Label>
                <ImageUpload value={photoUrl} onChange={setPhotoUrl} folder="authorized-persons" userId={user?.id || ''} />
              </div>
              <Button onClick={handleAdd} disabled={submitting || !name.trim()} className="w-full">
                {submitting ? <Loader2 size={16} className="mr-1 animate-spin" /> : null} Add Person
              </Button>
            </div>
          </DrawerContent>
        </Drawer>

        {persons.filter(p => p.is_active).length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Users className="mx-auto mb-3" size={40} />
            <p className="text-sm">No authorized persons added yet</p>
            <p className="text-xs mt-1">Add family members so they can enter the gate without OTP</p>
          </div>
        ) : (
          persons.filter(p => p.is_active).map(p => (
            <Card key={p.id}>
              <CardContent className="p-3 flex items-center gap-3">
                {p.photo_url ? (
                  <img src={p.photo_url} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User size={18} className="text-primary" />
                  </div>
                )}
                <div className="flex-1">
                  <p className="font-medium text-sm">{p.person_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">{p.relationship}</Badge>
                    {p.phone && <span className="flex items-center gap-0.5"><Phone size={10} /> {p.phone}</span>}
                  </div>
                </div>
                <ConfirmAction
                  title="Remove Person?"
                  description={`Remove ${p.person_name} from authorized persons list?`}
                  actionLabel="Remove"
                  onConfirm={() => handleRemove(p.id)}
                >
                  <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0">
                    <Trash2 size={14} />
                  </Button>
                </ConfirmAction>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
