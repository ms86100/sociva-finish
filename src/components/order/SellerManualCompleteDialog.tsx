import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, CheckCircle } from 'lucide-react';
import { SELLER_MANUAL_COMPLETE_COPY } from '@/lib/seller-manual-complete';

interface SellerManualCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<{ ok: boolean; alreadyComplete?: boolean; error?: string }>;
}

export function SellerManualCompleteDialog({
  open,
  onOpenChange,
  onConfirm,
}: SellerManualCompleteDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (open) {
      setSuccess(false);
      setErrorMessage(null);
      setIsSubmitting(false);
    }
  }, [open]);

  const handleConfirm = async () => {
    if (isSubmitting || success) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await onConfirm();
      if (!result?.ok) {
        setErrorMessage(result?.error || 'Could not complete this order. Try again.');
        return;
      }
      if (result.alreadyComplete) {
        onOpenChange(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => onOpenChange(false), 900);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not complete this order. Try again.';
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSubmitting) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{SELLER_MANUAL_COMPLETE_COPY.title}</DialogTitle>
          <DialogDescription>
            {SELLER_MANUAL_COMPLETE_COPY.body}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-2 text-center py-4">
            <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle size={32} className="text-success" strokeWidth={2.5} />
            </div>
            <p className="text-sm font-semibold text-foreground">Order completed</p>
            <p className="text-xs text-muted-foreground">Marked as delivered without OTP verification</p>
          </div>
        ) : (
          <>
            {errorMessage && (
              <p className="text-xs text-destructive font-medium">{errorMessage}</p>
            )}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                {SELLER_MANUAL_COMPLETE_COPY.cancel}
              </Button>
              <Button onClick={handleConfirm} disabled={isSubmitting} className="gap-2">
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {isSubmitting ? 'Completing...' : SELLER_MANUAL_COMPLETE_COPY.confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
