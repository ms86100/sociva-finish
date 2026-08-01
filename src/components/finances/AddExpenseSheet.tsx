// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';
import { friendlyError } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

const EXPENSE_CATEGORIES = [
  { value: 'security', label: 'Security' },
  { value: 'water', label: 'Water' },
  { value: 'electricity', label: 'Electricity' },
  { value: 'repairs', label: 'Repairs' },
  { value: 'gardening', label: 'Gardening' },
  { value: 'lift_maintenance', label: 'Lift Maintenance' },
  { value: 'staff_salaries', label: 'Staff Salaries' },
  { value: 'miscellaneous', label: 'Miscellaneous' },
];

const INCOME_SOURCES = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'penalty', label: 'Penalty' },
  { value: 'interest', label: 'Interest' },
  { value: 'other', label: 'Other' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  type: 'expense' | 'income';
}

export function AddExpenseSheet({ open, onOpenChange, onCreated, type }: Props) {
  const { user, profile, viewAsSocietyId } = useAuth();
  const { currencySymbol } = useCurrency();
  const [category, setCategory] = useState(type === 'expense' ? 'miscellaneous' : 'maintenance');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [invoiceUrl, setInvoiceUrl] = useState<string | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!amount || !user || !profile?.society_id) return;
    if (type === 'expense' && !title.trim()) return;
    setSaving(true);
    try {
      if (type === 'expense') {
        const { error } = await supabase.from('society_expenses').insert({
          society_id: profile.society_id,
          category,
          title: title.trim(),
          amount: Number(amount),
          vendor_name: vendorName.trim() || null,
          invoice_url: invoiceUrl,
          expense_date: date,
          added_by: user.id,
        } as any);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('society_income').insert({
          society_id: profile.society_id,
          source: category,
          amount: Number(amount),
          description: title.trim() || null,
          income_date: date,
          added_by: user.id,
        } as any);
        if (error) throw error;
      }
      toast({ title: `${type === 'expense' ? 'Expense' : 'Income'} added!` });
      setTitle(''); setAmount(''); setVendorName(''); setInvoiceUrl(null);
      setCategory(type === 'expense' ? 'miscellaneous' : 'maintenance');
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast({ title: 'Failed', description: friendlyError(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const categories = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_SOURCES;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Add {type === 'expense' ? 'Expense' : 'Income'}</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 px-4 pb-6">
          <div>
            <Label>{type === 'expense' ? 'Category' : 'Source'}</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{type === 'expense' ? 'Title' : 'Description (optional)'}</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder={type === 'expense' ? 'e.g. Guard salary - Jan' : 'e.g. Q1 maintenance'} />
          </div>
          <div>
            <Label>Amount ({currencySymbol})</Label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
          </div>
          {type === 'expense' && (
            <div>
              <Label>Vendor Name (optional)</Label>
              <Input value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="e.g. ABC Security Services" />
            </div>
          )}
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          {type === 'expense' && user && (
            <div>
              <Label>Invoice (optional)</Label>
              <ImageUpload value={invoiceUrl} onChange={setInvoiceUrl} folder="invoices" userId={user.id} />
            </div>
          )}
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !amount || (type === 'expense' && !title.trim()) || !!viewAsSocietyId}>
            {saving && <Loader2 size={16} className="animate-spin mr-2" />}
            Add {type === 'expense' ? 'Expense' : 'Income'}
          </Button>
          {viewAsSocietyId && (
            <p className="text-xs text-muted-foreground text-center">You are viewing another society. Switch back to create content.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
