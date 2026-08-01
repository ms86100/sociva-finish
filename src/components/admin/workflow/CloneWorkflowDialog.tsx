// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { TRANSACTION_TYPES, type WorkflowGroup, formatName } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: WorkflowGroup | null;
  existingWorkflows: WorkflowGroup[];
  onCloned: () => void;
}

export function CloneWorkflowDialog({ open, onOpenChange, source, existingWorkflows, onCloned }: Props) {
  const [parentGroups, setParentGroups] = useState<{ slug: string; name: string }[]>([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [customGroup, setCustomGroup] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [useCustom, setUseCustom] = useState(false);

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

  const handleClone = async () => {
    if (!source || !finalGroup || !transactionType) return;
    if (isDuplicate) {
      toast.error('This workflow already exists');
      return;
    }

    setIsCloning(true);
    try {
      // Clone steps
      const stepsToInsert = source.steps.map(s => ({
        parent_group: finalGroup,
        transaction_type: transactionType,
        status_key: s.status_key,
        sort_order: s.sort_order,
        actor: s.actor,
        is_terminal: s.is_terminal,
        display_label: s.display_label,
        color: s.color,
        icon: s.icon,
        buyer_hint: s.buyer_hint,
        seller_hint: s.seller_hint,
      }));

      const { error: stepsError } = await supabase.from('category_status_flows').insert(stepsToInsert);
      if (stepsError) throw stepsError;

      // Clone transitions
      const { data: srcTransitions } = await supabase
        .from('category_status_transitions')
        .select('from_status, to_status, allowed_actor')
        .eq('parent_group', source.parent_group)
        .eq('transaction_type', source.transaction_type);

      if (srcTransitions && srcTransitions.length > 0) {
        const transToInsert = srcTransitions.map(t => ({
          parent_group: finalGroup,
          transaction_type: transactionType,
          from_status: t.from_status,
          to_status: t.to_status,
          allowed_actor: t.allowed_actor,
        }));
        const { error: transError } = await supabase.from('category_status_transitions').insert(transToInsert);
        if (transError) throw transError;
      }

      toast.success(`Workflow cloned from ${formatName(source.parent_group)}!`);
      onOpenChange(false);
      onCloned();
    } catch (err: any) {
      toast.error(`Clone failed: ${err.message}`);
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold">
            Clone: {source ? `${formatName(source.parent_group)} / ${formatName(source.transaction_type)}` : ''}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          All {source?.step_count || 0} steps and transitions will be copied to the new workflow.
        </p>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-semibold">Target Parent Group</Label>
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
            <Label className="text-xs font-semibold">Target Transaction Type</Label>
            <Select value={transactionType} onValueChange={setTransactionType}>
              <SelectTrigger className="h-9 rounded-lg text-sm">
                <SelectValue placeholder="Select type..." />
              </SelectTrigger>
              <SelectContent>
                {TRANSACTION_TYPES.map(t => (
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
          <Button onClick={handleClone} disabled={isCloning || !finalGroup || !transactionType || isDuplicate} className="w-full h-10 rounded-xl font-semibold">
            {isCloning ? 'Cloning...' : 'Clone Workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
