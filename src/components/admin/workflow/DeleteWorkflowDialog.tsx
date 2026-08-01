// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';
import { type WorkflowGroup, formatName } from './types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowGroup | null;
  onDeleted: () => void;
}

export function DeleteWorkflowDialog({ open, onOpenChange, workflow, onDeleted }: Props) {
  const [linkedCategories, setLinkedCategories] = useState<{ category: string; display_name: string }[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (open && workflow) {
      supabase
        .from('category_config')
        .select('category, display_name')
        .eq('parent_group', workflow.parent_group)
        .eq('transaction_type', workflow.transaction_type)
        .then(({ data }) => setLinkedCategories(data || []));
    }
  }, [open, workflow]);

  const handleDelete = async () => {
    if (!workflow) return;
    setIsDeleting(true);
    try {
      await supabase
        .from('category_status_transitions')
        .delete()
        .eq('parent_group', workflow.parent_group)
        .eq('transaction_type', workflow.transaction_type);

      await supabase
        .from('category_status_flows')
        .delete()
        .eq('parent_group', workflow.parent_group)
        .eq('transaction_type', workflow.transaction_type);

      toast.success('Workflow deleted');
      onOpenChange(false);
      onDeleted();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-destructive flex items-center gap-2">
            <AlertTriangle size={16} /> Delete Workflow
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            This will permanently delete <strong>{workflow ? `${formatName(workflow.parent_group)} / ${formatName(workflow.transaction_type)}` : ''}</strong> ({workflow?.step_count} steps and all transitions).
          </p>

          {linkedCategories.length > 0 && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-destructive">⚠ These categories use this workflow and will fall back to the "default" workflow:</p>
              <div className="flex flex-wrap gap-1">
                {linkedCategories.map(c => (
                  <Badge key={c.category} variant="outline" className="text-[10px]">
                    {c.display_name}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 h-10 rounded-xl">
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting} className="flex-1 h-10 rounded-xl font-semibold">
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
