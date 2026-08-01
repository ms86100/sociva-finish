// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Loader2, AlertTriangle } from 'lucide-react';
import { CategoryConfigRow } from '@/hooks/useCategoryManagerData';
import { useAvailableWorkflows } from '@/hooks/useAvailableWorkflows';

interface Props {
  editingCategory: CategoryConfigRow | null;
  newTransactionType: string;
  isSaving: boolean;
  onConfirmedSave: () => void;
}

export function TransactionTypeConfirmSave({ editingCategory, newTransactionType, isSaving, onConfirmedSave }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [affectedCount, setAffectedCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: workflows } = useAvailableWorkflows();

  const transactionTypeChanged = editingCategory?.transaction_type !== newTransactionType;

  const getLabel = (key: string) => workflows?.find(w => w.key === key)?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const handleClick = async () => {
    if (!transactionTypeChanged) {
      onConfirmedSave();
      return;
    }
    setLoading(true);
    try {
      const { count } = await supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('category', editingCategory!.category);
      setAffectedCount(count ?? 0);
    } catch {
      setAffectedCount(0);
    }
    setLoading(false);
    setShowConfirm(true);
  };

  const oldLabel = getLabel(editingCategory?.transaction_type ?? '');
  const newLabel = getLabel(newTransactionType);

  return (
    <>
      <Button onClick={handleClick} disabled={isSaving || loading} className="w-full rounded-xl h-11 font-semibold">
        {(isSaving || loading) && <Loader2 className="animate-spin mr-2" size={16} />}
        Save Changes
      </Button>

      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="text-destructive" size={20} />
              Change Workflow?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You're changing <strong>{editingCategory?.display_name}</strong> from{' '}
                  <strong>{oldLabel}</strong> → <strong>{newLabel}</strong>.
                </p>
                {affectedCount !== null && affectedCount > 0 && (
                  <p className="font-medium text-foreground">
                    {affectedCount} existing product{affectedCount !== 1 ? 's' : ''} will use the new workflow.
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  Existing orders and bookings will not be affected.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowConfirm(false); onConfirmedSave(); }}
              disabled={isSaving}
            >
              {isSaving ? 'Saving…' : 'Confirm & Save'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
