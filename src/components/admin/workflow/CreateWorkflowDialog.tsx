// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { adminNotify } from '@/lib/admin-notify';
import { type WorkflowGroup } from './types';
import { notify } from '@/lib/notify';
import { useAvailableWorkflows } from '@/hooks/useAvailableWorkflows';
import { friendlyError } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingWorkflows: WorkflowGroup[];
  onCreated: () => void;
}

export function CreateWorkflowDialog({ open, onOpenChange, existingWorkflows, onCreated }: Props) {
  const [parentGroups, setParentGroups] = useState<{ slug: string; name: string }[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [useCustom, setUseCustom] = useState(false);
  const { data: availableWorkflows = [] } = useAvailableWorkflows();

  // Prefer DB workflow keys; keep a small seed list if DB is empty
  const typeOptions = availableWorkflows.length > 0
    ? availableWorkflows.map((w) => ({ value: w.key, label: w.label }))
    : [
        { value: 'cart_purchase', label: 'Cart Purchase' },
        { value: 'seller_delivery', label: 'Seller Delivery' },
        { value: 'self_fulfillment', label: 'Self Fulfillment' },
        { value: 'service_booking', label: 'Service Booking' },
        { value: 'request_service', label: 'Request Service' },
        { value: 'contact_enquiry', label: 'Contact Enquiry' },
      ];

  useEffect(() => {
    if (open) {
      supabase.from('parent_groups').select('slug, name').order('sort_order').then(({ data }) => {
        setParentGroups(data || []);
      });
      setSelectedGroup('');
      setCustomGroup('');
      setTransactionType('');
      setUseCustom(false);
    }
  }, [open]);

  const finalGroup = useCustom ? customGroup.trim().toLowerCase().replace(/\s+/g, '_') : selectedGroup;

  const isDuplicate = existingWorkflows.some(
    w => w.parent_group === finalGroup && w.transaction_type === transactionType
  );

  const handleCreate = async () => {
    if (!finalGroup || !transactionType) {
      notify.block('Please select both parent group and transaction type');
      return;
    }
    if (isDuplicate) {
      adminNotify.error('This workflow already exists');
      return;
    }

    setIsCreating(true);
    try {
      const starterSteps = [
        { parent_group: finalGroup, transaction_type: transactionType, status_key: 'placed', sort_order: 10, actor: 'buyer', is_terminal: false, display_label: 'Placed', color: 'bg-blue-100 text-blue-700', icon: 'ShoppingBag', buyer_hint: 'Order placed successfully', seller_hint: 'New order received' },
        { parent_group: finalGroup, transaction_type: transactionType, status_key: 'completed', sort_order: 20, actor: 'seller', is_terminal: true, display_label: 'Completed', color: 'bg-green-100 text-green-700', icon: 'CheckCircle', buyer_hint: 'Order completed', seller_hint: 'Order fulfilled' },
      ];

      const { error } = await supabase.from('category_status_flows').insert(starterSteps);
      if (error) throw error;

      // Add a basic transition: placed → completed by seller
      await supabase.from('category_status_transitions').insert({
        parent_group: finalGroup,
        transaction_type: transactionType,
        from_status: 'placed',
        to_status: 'completed',
        allowed_actor: 'seller',
      });

      adminNotify.success('Workflow created! Customize the steps now.');
      onOpenChange(false);
      onCreated();
    } catch (err: any) {
      adminNotify.error(friendlyError(err) || 'Failed to create workflow');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">New Workflow</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Parent Group</Label>
            {!useCustom ? (
              <Select value={selectedGroup} onValueChange={setSelectedGroup}>
                <SelectTrigger className="h-9 rounded-lg text-sm">
                  <SelectValue placeholder="Select group..." />
                </SelectTrigger>
                <SelectContent>
                  {parentGroups.map(g => (
                    <SelectItem key={g.slug} value={g.slug}>{g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={customGroup}
                onChange={e => setCustomGroup(e.target.value)}
                placeholder="e.g. pets"
                className="h-9 text-sm rounded-lg font-mono"
              />
            )}
            <button
              onClick={() => setUseCustom(!useCustom)}
              className="text-[11px] text-primary hover:underline"
            >
              {useCustom ? '← Pick from existing groups' : '+ Enter custom group slug'}
            </button>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Transaction Type</Label>
            <Select value={transactionType} onValueChange={setTransactionType}>
              <SelectTrigger className="h-9 rounded-lg text-sm">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map(t => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isDuplicate && (
            <p className="text-xs text-destructive font-medium">⚠ This workflow already exists.</p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={handleCreate} disabled={isCreating || !finalGroup || !transactionType || isDuplicate} className="w-full h-10 rounded-xl font-semibold">
            {isCreating ? 'Creating...' : 'Create & Edit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
