// @ts-nocheck
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Loader2, ShieldAlert } from 'lucide-react';
import { notifySocietyAdmins } from '@/lib/society-notifications';
import { disputeSchema, validateForm } from '@/lib/validation-schemas';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateDisputeSheet({ open, onOpenChange, onCreated }: Props) {
  const { user, profile, viewAsSocietyId } = useAuth();
  const ml = useMarketplaceLabels();
  const categories = ml.disputeCategories();
  const [category, setCategory] = useState(categories[0]?.value || 'other');
  const [description, setDescription] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmitInner = async () => {
    if (!user || !profile?.society_id) return;

    const validation = validateForm(disputeSchema, { category, description, is_anonymous: isAnonymous });
    if (!validation.success) {
      const firstError = Object.values((validation as { success: false; errors: Record<string, string> }).errors)[0];
      toast.error(firstError as string);
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('dispute_tickets').insert({
        society_id: profile.society_id,
        submitted_by: user.id,
        category: validation.data.category,
        description: validation.data.description,
        is_anonymous: validation.data.is_anonymous ?? false,
      } as any);
      if (error) throw error;

      if (profile?.society_id) {
        notifySocietyAdmins(
          profile.society_id,
          `⚖️ New Dispute Filed`,
          `${category} concern: ${validation.data.description.substring(0, 80)}`,
          { type: 'dispute' }
        );
      }

      toast.success('Concern submitted — ' + ml.label('label_dispute_sla_notice'));
      setDescription('');
      setCategory(categories[0]?.value || 'other');
      setIsAnonymous(false);
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = useSubmitGuard(handleSubmitInner);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <ShieldAlert size={18} />
            {ml.label('label_neighborhood_guarantee')}
          </DrawerTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {ml.label('label_neighborhood_guarantee_desc')}
          </p>
        </DrawerHeader>
        <div className="space-y-4 px-4 pb-6">
          <div>
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe your concern in detail..."
              rows={4}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Submit Anonymously</p>
              <p className="text-xs text-muted-foreground">Committee won't see your identity</p>
            </div>
            <Switch checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          </div>
          <Button className="w-full" onClick={handleSubmit} disabled={saving || !description.trim() || !!viewAsSocietyId}>
            {saving && <Loader2 size={16} className="animate-spin mr-2" />}
            Submit Concern
          </Button>
          {viewAsSocietyId && (
            <p className="text-xs text-muted-foreground text-center">You are viewing another society. Switch back to create content.</p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
