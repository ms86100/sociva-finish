// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { addDays } from 'date-fns';
import { notify } from '@/lib/notify';

interface Props {
  onCreated: () => void;
}

export function CreateGroupBuySheet({ onCreated }: Props) {
  const { user, effectiveSocietyId } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    product_name: '', description: '', min_quantity: 5, unit: 'kg', target_price: '', expires_days: 7,
  });

  const handleSubmit = async () => {
    if (!user || !effectiveSocietyId) return;
    if (!form.product_name.trim()) { notify.block('Please enter a product name'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('collective_buy_requests').insert({
        created_by: user.id, society_id: effectiveSocietyId,
        product_name: form.product_name.trim(), description: form.description.trim() || null,
        min_quantity: form.min_quantity, unit: form.unit,
        target_price: form.target_price ? Number(form.target_price) : null,
        expires_at: addDays(new Date(), form.expires_days).toISOString(), status: 'active',
      });
      if (error) throw error;
      toast.success('Group buy created! Share it with your neighbors.');
      setOpen(false);
      setForm({ product_name: '', description: '', min_quantity: 5, unit: 'kg', target_price: '', expires_days: 7 });
      onCreated();
    } catch (err: any) { toast.error(err.message || 'Failed to create'); }
    finally { setSaving(false); }
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button size="sm" className="text-xs gap-1"><Plus size={14} /> Start Group Buy</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader><DrawerTitle>Start a Group Buy</DrawerTitle></DrawerHeader>
        <div className="space-y-4 mt-4">
          <div>
            <Label className="text-xs">What do you want to buy together?</Label>
            <Input placeholder="e.g. Alphonso Mangoes, Rice, Detergent..." value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Description (optional)</Label>
            <Textarea placeholder="Details like preferred brand, quality..." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label className="text-xs">Min Quantity</Label><Input type="number" min={2} value={form.min_quantity} onChange={(e) => setForm({ ...form, min_quantity: Number(e.target.value) })} /></div>
            <div><Label className="text-xs">Unit</Label><Input placeholder="kg, pcs, liters..." value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            <div><Label className="text-xs">Target Price</Label><Input type="number" placeholder="₹ per unit" value={form.target_price} onChange={(e) => setForm({ ...form, target_price: e.target.value })} /></div>
          </div>
          <div>
            <Label className="text-xs">Expires in</Label>
            <div className="flex gap-2 mt-1">
              {[3, 5, 7, 14].map((d) => (
                <Button key={d} size="sm" variant={form.expires_days === d ? 'default' : 'outline'} className="text-xs flex-1" onClick={() => setForm({ ...form, expires_days: d })}>{d} days</Button>
              ))}
            </div>
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={saving}>{saving ? 'Creating...' : 'Create Group Buy'}</Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
