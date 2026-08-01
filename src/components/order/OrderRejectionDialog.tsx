// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, XCircle } from 'lucide-react';

interface OrderRejectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: (reason: string) => Promise<void>;
  orderNumber: string;
}

const REJECTION_REASONS = [
  'Item(s) out of stock',
  'Kitchen closed / Not available now',
  'Too many orders at the moment',
  'Unable to fulfill special instructions',
  'Incorrect order details',
  'Other reason',
];

export function OrderRejectionDialog({
  open,
  onOpenChange,
  onReject,
  orderNumber,
}: OrderRejectionDialogProps) {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReject = async () => {
    const reason = selectedReason === 'Other reason' ? customReason : selectedReason;
    
    if (!reason.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onReject(reason);
      onOpenChange(false);
      setSelectedReason('');
      setCustomReason('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = selectedReason && (selectedReason !== 'Other reason' || customReason.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="text-destructive" size={20} />
            Reject Order
          </DialogTitle>
          <DialogDescription>
            Please provide a reason for rejecting order #{orderNumber.slice(-6)}. 
            The buyer will be notified with your message.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <RadioGroup value={selectedReason} onValueChange={setSelectedReason}>
            {REJECTION_REASONS.map((reason) => (
              <div key={reason} className="flex items-center space-x-2">
                <RadioGroupItem value={reason} id={reason} />
                <Label htmlFor={reason} className="text-sm cursor-pointer">
                  {reason}
                </Label>
              </div>
            ))}
          </RadioGroup>

          {selectedReason === 'Other reason' && (
            <div className="space-y-2">
              <Label htmlFor="custom-reason">Your reason</Label>
              <Textarea
                id="custom-reason"
                placeholder="Please explain why you're rejecting this order..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                rows={3}
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleReject}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin mr-2" size={16} />
            ) : null}
            Reject Order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
